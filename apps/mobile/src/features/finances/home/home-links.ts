// Addresses the «Финансы» home screen leaves through. Pure, so the exact
// strings stay pinned by tests.

import { financesFrom } from "@/features/appointments/return-to";
import { NO_TEAM } from "../accounts-sections";

/** Real team of the chip: the «Без команды» pseudo-scope carries none. */
const chipTeam = (scope: string | null): string | null =>
  scope && scope !== NO_TEAM ? scope : null;

// Настройки открываются на команде, которую смотрят (владелец 2026-09-24:
// «настройки в финансах по каждой команде»).
export function financeSettingsHref(scope: string | null): string {
  const team = chipTeam(scope);
  return team ? `/finances/settings?team=${encodeURIComponent(team)}` : "/finances/settings";
}

// Команда чипа — команда счёта (ставка VAT, касса, «Документы» этой
// команды); без неё инвойс уходил первой команде (аудит 2026-09-30).
export function newInvoiceHref(scope: string | null): string {
  const team = chipTeam(scope);
  return team ? `/invoices/new?teamId=${encodeURIComponent(team)}` : "/invoices/new";
}

/** Адрес записи в календаре — тот же, каким её открывают из карточки клиента
 *  и из пуша: календарь сам встаёт на её день и её команду. */
export function appointmentHref(
  target: { id: string; date: string; team_id?: string | null },
  back: { view: string; account: string | null; team: string | null },
): string {
  return (
    `/(dashboard)?appointmentId=${target.id}&date=${target.date}` +
    (target.team_id ? `&teamId=${target.team_id}` : "") +
    // Дорога назад: закрыв запись, человек возвращается в ленту денег, а не
    // остаётся в календаре (владелец 2026-08-15) — и в ТОТ ЖЕ разрез, из
    // которого ушёл: вкладка пересоздаётся, и «Доход» сбрасывался на «Все».
    // И в ту же команду чипа (аудит 2026-09-30): без неё вкладка вставала
    // на первую команду.
    `&from=${encodeURIComponent(financesFrom(back.view, { account: back.account, team: back.team }))}`
  );
}
