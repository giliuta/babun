// УБОРЩИК STORAGE — ночной снос файлов, на которые ничто не ссылается.
//
// Что сносить, решает SQL (`storage_janitor_candidates`, миграция
// `storage_janitor`): только он видит `storage.objects` рядом со всеми
// ссылками и снимками в ящиках «Удалённые …». Сносит эта функция — Storage
// API сервисным ключом, потому что SQL блобы не стирает
// (`storage.protect_delete()`).
//
// Зовёт крон (pg_net) с `x-cleanup-secret` из `edge_cron_secrets`
// («storage-janitor»); `verify_jwt = false`. `{"mode":"dry"}` отвечает списком
// кандидатов и ничего не трогает — так проверяют первый запуск.

import { serviceClient } from "../_shared/service-client.ts";
import { constantTimeEqual, json } from "../_shared/http.ts";
import { removePaths } from "../_shared/tenant-storage.ts";

/** Кандидатов за один вопрос к SQL — предел функции. */
const BATCH = 500;
/** Проходов за запуск: остаток уйдёт следующей ночью. */
const MAX_ROUNDS = 10;

interface Candidate {
  bucket_id: string;
  name: string;
  reason: string;
}

function parseCandidates(value: unknown): Candidate[] | null {
  if (!Array.isArray(value)) return null;
  const rows: Candidate[] = [];
  for (const row of value) {
    const r = row as Record<string, unknown> | null;
    if (
      !r ||
      typeof r.bucket_id !== "string" ||
      typeof r.name !== "string" ||
      typeof r.reason !== "string"
    ) {
      return null;
    }
    rows.push({ bucket_id: r.bucket_id, name: r.name, reason: r.reason });
  }
  return rows;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json(405, { error: "Method not allowed" });

  const service = serviceClient();
  if (!service) return json(503, { error: "Storage janitor is unavailable" });

  const supplied = request.headers.get("x-cleanup-secret") ?? "";
  const { data: secretRow, error: secretError } = await service
    .from("edge_cron_secrets")
    .select("secret")
    .eq("name", "storage-janitor")
    .single();
  if (
    !supplied ||
    secretError ||
    typeof secretRow?.secret !== "string" ||
    !constantTimeEqual(supplied, secretRow.secret)
  ) {
    return json(401, { error: "Unauthorized" });
  }

  let mode = "run";
  try {
    const body = (await request.json()) as { mode?: unknown };
    if (body?.mode === "dry") mode = "dry";
  } catch {
    // Пустое тело — обычный запуск.
  }

  const removedByReason: Record<string, number> = {};
  let removed = 0;
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const { data, error } = await service.rpc("storage_janitor_candidates", { p_limit: BATCH });
    if (error) {
      console.error("storage-janitor candidates failed", { code: error.code });
      return json(500, { error: "Candidates unavailable", removed });
    }
    const candidates = parseCandidates(data);
    if (!candidates) return json(500, { error: "Unexpected candidates shape", removed });
    if (mode === "dry") return json(200, { mode, candidates });
    if (candidates.length === 0) break;

    let roundRemoved = 0;
    const byBucket = new Map<string, Candidate[]>();
    for (const c of candidates) byBucket.set(c.bucket_id, [...(byBucket.get(c.bucket_id) ?? []), c]);
    for (const [bucket, rows] of byBucket) {
      try {
        const n = await removePaths(service, bucket, rows.map((r) => r.name));
        roundRemoved += n;
        for (const r of rows) removedByReason[r.reason] = (removedByReason[r.reason] ?? 0) + 1;
      } catch (e) {
        console.error("storage-janitor remove failed", {
          bucket,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
    removed += roundRemoved;
    // Ничего не ушло — те же кандидаты придут снова: крутить незачем.
    if (roundRemoved === 0 || candidates.length < BATCH) break;
  }

  console.log("storage-janitor done", { removed, removedByReason });
  return json(200, { mode, removed, removedByReason });
});
