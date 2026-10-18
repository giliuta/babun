// Addresses the «Финансы» home screen leaves through. Pure, so the exact
// strings stay pinned by tests.

import { NO_TEAM } from "../accounts-sections";

/** Real team of the chip: the «Без команды» pseudo-scope carries none. */
const chipTeam = (scope: string | null): string | null =>
  scope && scope !== NO_TEAM ? scope : null;

// Настройки открываются на команде, которую смотрят (настройки финансов — по каждой команде).
export function financeSettingsHref(scope: string | null): string {
  const team = chipTeam(scope);
  return team ? `/finances/settings?team=${encodeURIComponent(team)}` : "/finances/settings";
}

// Команда чипа — команда счёта (ставка VAT, касса, «Документы» этой
// команды); без неё инвойс уходил первой команде.
export function newInvoiceHref(scope: string | null): string {
  const team = chipTeam(scope);
  return team ? `/invoices/new?teamId=${encodeURIComponent(team)}` : "/invoices/new";
}

/** Адрес страницы записи — ПОВЕРХ денег, а не через календарь. Прежде запись
 *  открывалась через вкладку календаря: экран переключался, календарь
 *  перестраивал день, и только потом выезжала запись, а закрытие заменяло её
 *  пересозданной вкладкой денег — всё прыгало. Теперь запись выезжает справа
 *  над лентой, «назад» уводит её обратно, а лента остаётся как была: тот же
 *  разрез, та же команда, та же прокрутка. */
export function appointmentHref(target: { id: string }): string {
  return `/book?appointmentId=${encodeURIComponent(target.id)}`;
}
