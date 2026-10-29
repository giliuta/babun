// СПИСОК КЛИЕНТОВ ОКНА — СТРАНИЦАМИ. Лист без зависимостей: его зовут
// `member-reads.ts` и тест (`client-window.test.ts`).
//
// PostgREST режет любой ответ на 1000 строк и молчит:
// у партнёра или мастера с базой больше тысячи клиентов (перенос из Bumpix)
// список кончался на тысячной строке. Окна принимают `p_offset`/`p_limit`
// (20261028200000), порядок у сервера устойчивый (`full_name, id`). Пока
// функция на сервере прежняя (`PGRST202` — нет подписи с этими параметрами),
// читаем одним вызовом, как раньше.
export const CLIENT_PAGE = 1000;
const MISSING_FUNCTION = new Set(["PGRST202", "42883"]);

export type ListRpc = (
  name: "list_master_clients_safe" | "list_member_clients",
  args?: Record<string, unknown>,
) => PromiseLike<{ data: unknown[] | null; error: { message: string; code?: string } | null }>;

/** Все строки окна: страницами, а на прежнем сервере — одним вызовом. Карточка
 *  одного клиента (`clientId`) — всегда одним вызовом. */
export async function readClientWindow(
  rpc: ListRpc,
  name: "list_master_clients_safe" | "list_member_clients",
  clientId?: string,
): Promise<unknown[]> {
  if (clientId) {
    const { data, error } = await rpc(name, { p_client_id: clientId });
    if (error) throw new Error(`${name}: ${error.message}`);
    return data ?? [];
  }
  const rows: unknown[] = [];
  for (let offset = 0; ; offset += CLIENT_PAGE) {
    const { data, error } = await rpc(name, { p_offset: offset, p_limit: CLIENT_PAGE });
    if (error) {
      if (offset === 0 && error.code && MISSING_FUNCTION.has(error.code)) {
        const legacy = await rpc(name);
        if (legacy.error) throw new Error(`${name}: ${legacy.error.message}`);
        return legacy.data ?? [];
      }
      throw new Error(`${name}: ${error.message}`);
    }
    const page = data ?? [];
    rows.push(...page);
    if (page.length < CLIENT_PAGE) return rows;
  }
}

