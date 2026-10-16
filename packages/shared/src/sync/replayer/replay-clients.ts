// Client-only replay rules: the client + tags aggregate insert through RPC,
// its field blacklist, and the client cache row after a conflict.

import type { Database, Json } from "../../db/database.types";
import {
  cacheDelete,
  cacheGetOne,
  cacheUpsert,
  type CachedClientData,
  type QueuedOp,
} from "../../db/cache/sql";
import { rowToClient } from "../../db/repositories/clients";
import { isUuid } from "../uuid";
import type { DbSupabase, PreparedInsert } from "./relay";

/** Strip the queue-only `__tag_ids` and decide how the client insert
 *  replays: the aggregate RPC, or the generic direct INSERT. */
export function prepareClientInsert(op: QueuedOp): PreparedInsert {
  let payload = op.payload as Record<string, unknown>;
  const queuedClientTagIds = Array.isArray(payload.__tag_ids)
    ? payload.__tag_ids.filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      )
    : [];
  if ("__tag_ids" in payload) {
    const { __tag_ids: _queueMetadata, ...databasePayload } = payload;
    void _queueMetadata;
    payload = databasePayload;
  }

  // A client plus its tag assignments is one aggregate. Replaying it as a
  // direct INSERT followed by junction upserts could leave a half-created
  // client after a crash/RLS error. When tags are present, use the same
  // transaction-owning RPC as the online repository. A lost successful
  // response is repaired idempotently through update_client_with_tags on
  // the next duplicate-key attempt.
  // КЛИЕНТ ВСЕГДА ВСТАЁТ ТОЙ ЖЕ ДВЕРЬЮ, ЧТО В СЕТИ. Без
  // тегов он шёл бы прямой вставкой — мимо серверных умолчаний
  // `create_client_with_tags`, главное из которых команда: в сети пустую
  // команду функция заменяет первой активной, а с очереди клиент уехал бы с
  // `team_id = NULL`, и партнёрам его не было бы видно. Прямая вставка
  // осталась только для старых строк с не-UUID id (ниже, v489).
  if (queuedClientTagIds.length > 0 || isUuid(op.row_id)) {
    const aggregatePayload = payload;
    return {
      payload,
      aggregate: (supabase) =>
        replayClientAggregate(supabase, op, aggregatePayload, queuedClientTagIds),
    };
  }
  return { payload, aggregate: null };
}

async function replayClientAggregate(
  supabase: DbSupabase,
  op: QueuedOp,
  payload: Record<string, unknown>,
  queuedClientTagIds: string[],
): Promise<void> {
  if (!isUuid(op.row_id)) {
    throw new Error(
      "replay client tags: client id is not a UUID; aggregate cannot be restored",
    );
  }
  const tenantId = payload.tenant_id;
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    throw new Error("replay client tags: tenant_id is missing");
  }
  // Тот же белый список, что и у онлайн-записи: RPC не принимает
  // идентичность, сторожок LWW и `purge_at` (срок корзины ставит только
  // удаление прямым UPDATE). Лишний ключ = отказ 22023 на всю очередь.
  // `sms_opt_out` — тоже мимо: отказ от SMS правится своей функцией
  // (`set_client_sms_opt_out`), а очередь кладёт его в строку нового
  // клиента. С ним клиента с тегом, заведённого без сети, сервер отбивал бы
  // на каждом повторе, и после трёх попыток он пропал бы с телефона.
  const {
    id: _id,
    tenant_id: _tenantId,
    updated_at: _updatedAt,
    purge_at: _purgeAt,
    sms_opt_out: _smsOptOut,
    ...clientPayload
  } = payload;
  void _id;
  void _tenantId;
  void _updatedAt;
  void _purgeAt;
  void _smsOptOut;
  const { error: aggregateError } = await supabase.rpc(
    "create_client_with_tags",
    {
      p_tenant_id: tenantId,
      p_client_id: op.row_id,
      p_client: clientPayload as Json,
      p_tag_ids: [...new Set(queuedClientTagIds)],
    },
  );
  if (aggregateError) {
    const duplicate =
      aggregateError.code === "23505" ||
      /duplicate key/i.test(aggregateError.message);
    // Без тегов дубль — либо клиент уже на сервере (ответ прошлой попытки
    // потерялся), либо номер занят ЧУЖИМ клиентом; различает сервер, как
    // у прямой вставки ниже. Теги при этом не трогаем: пустой список
    // снял бы теги, поставленные с другого телефона.
    if (duplicate && queuedClientTagIds.length === 0) {
      const probe = await supabase
        .from("clients")
        .select("id")
        .eq("id", op.row_id)
        .maybeSingle();
      if (probe.data) return;
      throw new Error(
        "Клиент с таким номером уже заведён — откройте его карточку, а этот черновик удалите",
      );
    }
    if (!duplicate) {
      const unavailable =
        aggregateError.code === "PGRST202" ||
        /could not find the function|schema cache|does not exist/i.test(
          aggregateError.message,
        );
      throw new Error(
        unavailable
          ? "Безопасная синхронизация меток клиента ждёт обновления серверной схемы. Локальный клиент сохранён и останется в очереди."
          : `replay client aggregate: ${aggregateError.message}`,
      );
    }
    const { error: repairError } = await supabase.rpc(
      "update_client_with_tags",
      {
        p_tenant_id: tenantId,
        p_client_id: op.row_id,
        p_patch: {},
        p_tag_ids: [...new Set(queuedClientTagIds)],
      },
    );
    if (repairError) {
      throw new Error(`replay client aggregate repair: ${repairError.message}`);
    }
  }
}

/** Canonical server client row → cache, after a conflict. */
export async function cacheClientServerRow(
  rowId: string,
  row: Record<string, unknown>,
): Promise<void> {
  if (row.deleted_at != null) {
    // Soft archive is represented by UPDATE, but the clients SQLite table
    // is the active-list cache. A last-write-wins retry must keep the row
    // hidden instead of re-inserting the archived server response.
    await cacheDelete("clients", rowId);
    return;
  }
  // Прошлая строка кэша нужна, чтобы не потерять теги: обычный UPDATE
  // не трогает назначения, а в ответе их нет.
  const prevCached = await cacheGetOne<CachedClientData>("clients", rowId).catch(
    () => null,
  );
  await cacheUpsert("clients", clientCacheRow(row, prevCached));
}

function clientCacheRow(
  row: Record<string, unknown>,
  /** Прошлая строка кэша — из неё берём то, чего нет в ответе UPDATE. */
  previous?: Partial<CachedClientData> | null,
): CachedClientData {
  // Кэш клиентов хранит ДОМЕННУЮ форму (Client + tenant_id + updated_at).
  // Раньше сюда клалась СЫРАЯ серверная строка: у неё нет tag_ids, и
  // вкладка «Клиенты» падала на `client.tag_ids.map` сразу после любого
  // конфликта LWW.
  const r = row as Database["public"]["Tables"]["clients"]["Row"];
  const prevTags = previous?.tag_ids;
  return {
    ...rowToClient(r),
    // Обычный UPDATE не трогает назначения тегов — сохраняем известные.
    tag_ids: Array.isArray(prevTags) ? (prevTags as string[]) : [],
    tenant_id: r.tenant_id,
    updated_at: r.updated_at,
  } satisfies CachedClientData;
}

/** Id of the client this queued insert creates, or null. */
export function clientInsertId(op: QueuedOp): string | null {
  return op.table === "clients" && op.op === "insert" ? op.row_id : null;
}

/** Client a non-client op points at (`payload.client_id`), or null. */
export function awaitedClientId(op: QueuedOp): string | null {
  if (op.table === "clients") return null;
  const clientId = (op.payload as { client_id?: unknown } | null)?.client_id;
  return typeof clientId === "string" ? clientId : null;
}
