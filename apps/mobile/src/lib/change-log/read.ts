import type { supabase } from "@/lib/supabase";
import type { ChangeLogRow } from "./row";

// ЧТЕНИЕ ЖУРНАЛА — ТОЛЬКО ФУНКЦИЕЙ `list_change_log`. Прямое чтение таблицы
// `change_log` открыто одному владельцу: партнёру функция отдаёт те же
// строки, что и раньше, но без полей блоков, скрытых от него в команде
// строки (телефон, заметка, сумма, адрес, имя клиента в подписи записи).
// Прочитай он таблицу сам — получил бы их целиком.

type Client = Pick<typeof supabase, "rpc">;

interface ListChangeLogArgs {
  p_from: string | null;
  p_to: string | null;
  p_before: number | null;
  p_actor: string | null;
  p_limit: number;
}

/** Функции ещё нет в сгенерированных типах базы — подпись описана здесь. */
type ChangeLogRpc = (
  fn: "list_change_log",
  args: ListChangeLogArgs,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

export interface ChangeLogQuery {
  /** Начало периода включительно (ISO). */
  from?: string | null;
  /** Конец периода, не включая (ISO). */
  to?: string | null;
  /** Только строки с `id` меньше этого — следующая страница. */
  before?: number | null;
  /** Только правки этого человека. */
  actor?: string | null;
  /** Не больше 1000 — столько отдаёт сервер за раз. */
  limit: number;
}

/** Строки журнала свежими сверху. */
export async function readChangeLog(client: Client, query: ChangeLogQuery): Promise<ChangeLogRow[]> {
  const rpc = client.rpc.bind(client) as unknown as ChangeLogRpc;
  const { data, error } = await rpc("list_change_log", {
    p_from: query.from ?? null,
    p_to: query.to ?? null,
    p_before: query.before ?? null,
    p_actor: query.actor ?? null,
    p_limit: query.limit,
  });
  if (error) throw new Error(`change_log: ${error.message}`);
  return Array.isArray(data) ? (data as ChangeLogRow[]) : [];
}
