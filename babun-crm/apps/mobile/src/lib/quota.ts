import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@babun/shared/db/database.types";
import type { QuotaGate } from "@babun/shared/sync";

type DbSupabase = SupabaseClient<Database>;
export type MobileQuotaKind = "clients" | "appointments_month";

const QUOTA_RPC = {
  clients: "tenant_quota_clients",
  appointments_month: "tenant_quota_appointments_month",
} as const;

export class MobileQuotaExceededError extends Error {
  readonly quota = true as const;
  readonly code = "quota_exceeded" as const;

  constructor(
    readonly kind: MobileQuotaKind,
    readonly current: number,
    readonly limit: number,
    readonly requested = 1,
  ) {
    const label = kind === "clients" ? "клиентов" : "записей в этом месяце";
    const available = Math.max(0, limit - current);
    super(
      requested > 1
        ? `Тарифный лимит: можно добавить ещё ${available} ${label}, выбрано ${requested}. Уменьшите импорт или измените тариф.`
        : `Тарифный лимит ${label} исчерпан (${current} из ${limit}). ${
            kind === "clients"
              ? "Измените тариф. Архивирование сохраняет историю и не уменьшает лимит."
              : "Измените тариф или дождитесь следующего месяца."
          }`,
    );
    this.name = "MobileQuotaExceededError";
  }
}

async function fetchQuota(
  client: DbSupabase,
  tenantId: string,
  kind: MobileQuotaKind,
): Promise<number> {
  const rpc = QUOTA_RPC[kind];
  const response = rpc === "tenant_quota_clients"
    ? await client.rpc("tenant_quota_clients", { t_id: tenantId })
    : await client.rpc("tenant_quota_appointments_month", { t_id: tenantId });
  if (response.error) {
    throw new Error(`Не удалось проверить тарифный лимит: ${response.error.message}`);
  }
  const value = Number(response.data);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Сервер вернул некорректный тарифный лимит.");
  }
  return value;
}

async function fetchCount(
  client: DbSupabase,
  tenantId: string,
  kind: MobileQuotaKind,
): Promise<number> {
  if (kind === "clients") {
    const { count, error } = await client
      .from("clients")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId);
    if (error) throw new Error(`Не удалось посчитать клиентов: ${error.message}`);
    return count ?? 0;
  }

  const now = new Date();
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toISOString();
  const { count, error } = await client
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .gte("created_at", monthStart);
  if (error) throw new Error(`Не удалось посчитать записи: ${error.message}`);
  return count ?? 0;
}

export async function fetchRemainingQuota(
  client: DbSupabase,
  tenantId: string,
  kind: MobileQuotaKind,
): Promise<number> {
  const [limit, current] = await Promise.all([
    fetchQuota(client, tenantId, kind),
    fetchCount(client, tenantId, kind),
  ]);
  return Math.max(0, limit - current);
}

export async function assertQuotaAvailable(
  client: DbSupabase,
  tenantId: string,
  kind: MobileQuotaKind,
  requested = 1,
): Promise<void> {
  if (!Number.isInteger(requested) || requested < 0) {
    throw new Error("Некорректное количество записей для проверки лимита.");
  }
  if (requested === 0) return;
  const [limit, current] = await Promise.all([
    fetchQuota(client, tenantId, kind),
    fetchCount(client, tenantId, kind),
  ]);
  if (current + requested > limit) {
    throw new MobileQuotaExceededError(kind, current, limit, requested);
  }
}

export type CreateQuotaPreflightResult = "checked" | "deferred-offline";

/** Best-effort online preflight for a single interactive create.
 *
 * A confirmed offline/transport failure deliberately falls through to the
 * cached wrapper, which can persist the create in SQLite and replay it later.
 * Quota, authorization and server errors still reject immediately. The
 * database trigger remains the final race-safe authority after this UX check.
 */
export async function preflightQuotaForCreate(
  client: DbSupabase,
  tenantId: string,
  kind: MobileQuotaKind,
  options: {
    online: boolean;
    isNetworkUnavailable: (error: unknown) => boolean;
  },
): Promise<CreateQuotaPreflightResult> {
  if (!options.online) return "deferred-offline";
  try {
    await assertQuotaAvailable(client, tenantId, kind);
    return "checked";
  } catch (error) {
    if (options.isNetworkUnavailable(error)) return "deferred-offline";
    throw error;
  }
}

export function createQuotaGate(client: DbSupabase): QuotaGate {
  return {
    async assertAvailable(op) {
      const kind: MobileQuotaKind | null =
        op.table === "clients"
          ? "clients"
          : op.table === "appointments"
            ? "appointments_month"
            : null;
      if (!kind) return;
      const tenantId = op.payload.tenant_id;
      if (typeof tenantId !== "string" || !tenantId) {
        throw new Error("В offline-операции отсутствует компания.");
      }
      await assertQuotaAvailable(client, tenantId, kind);
    },
  };
}
