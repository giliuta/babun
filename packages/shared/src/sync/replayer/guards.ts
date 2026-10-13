// Tenant and session guards the drain checks before and during a pass.

import type { ReplayerOptions } from "./options";
import type { DbSupabase } from "./relay";

/** Компания устройства сменилась ПОСРЕДИ отправки операции (аудит 03.10).
 *  Заголовок компании берётся в момент каждого запроса: силовая правка и
 *  проверка видимости после смены ушли бы под чужим заголовком, нашли бы
 *  ноль строк — и операция снималась бы как «строку удалили». Такая
 *  операция остаётся в очереди без попытки в счёт и уйдёт в своей
 *  компании. */
export class TenantSwitchedMidway extends Error {
  constructor() {
    super("Компания сменилась посреди отправки — операция подождёт свою компанию");
    this.name = "TenantSwitchedMidway";
  }
}

export function assertTenantStill(tenantStill?: () => boolean): void {
  if (tenantStill && !tenantStill()) throw new TenantSwitchedMidway();
}

/** Активная компания. Если хост дал ЖИВОЕ чтение, его ответ окончательный:
 *  null значит «компании нет» — человек вышел или идёт переход. Раньше null
 *  подменялся снимком с запуска (`?? opts.tenantId`), и слив после выхода из
 *  аккаунта шёл дальше под прежней компанией — уже без входа. Аноним по RLS
 *  не видит ни строки: удаление находило ноль строк, проверка видимости —
 *  тоже, и операция снималась как «уже удалено» (аудит 04.10). */
export function readTenantId(opts: ReplayerOptions): string | null {
  if (opts.currentTenantId) return opts.currentTenantId();
  return opts.tenantId ?? null;
}

/** Есть ли у клиента живой вход. Клиент без `auth` (тестовый, вид только для
 *  чтения) проверку не держит. Ошибка чтения сессии — «входа нет»: операции
 *  подождут следующего толчка, а не уйдут анонимом. */
export async function hasLiveSession(supabase: DbSupabase): Promise<boolean> {
  const auth = (supabase as unknown as {
    auth?: { getSession?: () => Promise<{ data?: { session?: unknown } | null }> };
  }).auth;
  if (typeof auth?.getSession !== "function") return true;
  try {
    const { data } = await auth.getSession();
    return Boolean(data?.session);
  } catch {
    return false;
  }
}

/** ПОЛЕ, КОТОРЫМ КЛИЕНТ ОБЪЯВЛЯЕТ СЕБЯ ВИДОМ ТОЛЬКО ДЛЯ ЧТЕНИЯ.
 *
 *  Шим постраничного чтения календаря (`pagingClient`) отдаётся обёртке
 *  `listAppointments` вместо клиента, и её фоновое перечитывание, увидев
 *  ждущие операции, подталкивает выгрузку ЭТИМ ЖЕ клиентом. А у шима
 *  `from()` умеет только `select`: выгрузка правки падала «update is not a
 *  function», операция после трёх попыток ложилась навсегда, и правка
 *  пропадала (владелец 03.10: сменил клиента записи — через десять секунд
 *  вернулся прежний). Вид объявляет себя этим полем, и выгрузка идёт
 *  настоящим клиентом хоста (`writeClient`), а без него не идёт вовсе. */
export const READ_ONLY_VIEW_FIELD = "__babunReadOnlyView";

export function isReadOnlyView(supabase: DbSupabase): boolean {
  return (supabase as unknown as Record<string, unknown>)[READ_ONLY_VIEW_FIELD] === true;
}

/** ПОЛЕ, КОТОРЫМ КЛИЕНТ ОБЪЯВЛЯЕТ СЕБЯ ПРИВЯЗАННЫМ К ОДНОЙ КОМПАНИИ.
 *
 *  Прогрев чужих компаний ходит клиентом, которому заголовок компании прибит
 *  намертво. Такой клиент не имеет права попасть в выгрузку: операция АКТИВНОЙ
 *  компании, отправленная под чужим заголовком, у вставки будет отбита
 *  сервером, а вот УДАЛЕНИЕ вернёт ноль строк — и это честно прочитается как
 *  «удалять нечего», после чего операция уйдёт из очереди. Тихая потеря
 *  работы.
 *
 *  Договор простой: привязанный клиент ОБЪЯВЛЯЕТ свою компанию этим полем, а
 *  выгрузка отказывается через него работать. Заслон стоит с обеих сторон —
 *  тот, кто создаёт такой клиент, следит, чтобы он не доехал сюда; выгрузка
 *  не верит этому на слово. Одной стороны мало: обёртки кэша зовут выгрузку
 *  напрямую, и достаточно одного нового места. */
export const BOUND_TENANT_FIELD = "__babunBoundTenantId";

export function boundTenantOf(supabase: DbSupabase): string | null {
  const value = (supabase as unknown as Record<string, unknown>)[
    BOUND_TENANT_FIELD
  ];
  return typeof value === "string" && value.length > 0 ? value : null;
}
