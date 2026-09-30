// АРХИВ КАЛЕНДАРЕЙ — ЧТО ПОКАЗАТЬ У КАЖДОГО.
//
// Владелец 2026-09-21: «удаляешь — оно кидается в архив и в архиве хранится…
// если я нажимаю Кабинет, там есть вкладка „Архив“, и уже в архиве полностью
// всё это есть». Строка архива отвечает на один вопрос: что лежит вместе с
// этим календарём — сколько записей и сколько денег на его счетах. Этого
// хватает, чтобы решить, вернуть его или стереть навсегда.
//
// Чистая функция в листе, без react-native и supabase: раннер тестов их не
// поднимает, а правило подписи должно проверяться.

import { formatCountRu } from "@babun/shared/common/utils/plural-ru";

export interface ArchiveTeamRow {
  id: string;
  name: string;
  color?: string | null;
  is_active: boolean;
  position?: number | null;
}
export interface ArchiveWorkRow {
  team_id?: string | null;
}
export interface ArchiveAccountRow {
  brigade_id?: string | null;
  balance?: number | null;
}

export interface ArchivedCalendar {
  id: string;
  name: string;
  color: string | null;
  appointments: number;
  accounts: number;
  /** Сумма остатков его счетов — деньги, которые уйдут при стирании. */
  balance: number;
}

/** Календари в архиве, в порядке ленты, с тем, что лежит вместе с ними. */
export function archivedCalendars(input: {
  teams: readonly ArchiveTeamRow[];
  appointments: readonly ArchiveWorkRow[];
  accounts: readonly ArchiveAccountRow[];
}): ArchivedCalendar[] {
  return input.teams
    .filter((team) => !team.is_active)
    .slice()
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((team) => {
      const accounts = input.accounts.filter((row) => row.brigade_id === team.id);
      return {
        id: team.id,
        name: team.name,
        color: team.color ?? null,
        appointments: input.appointments.filter((row) => row.team_id === team.id).length,
        accounts: accounts.length,
        balance: accounts.reduce((sum, row) => sum + (row.balance ?? 0), 0),
      };
    });
}

/** Подпись строки: «14 записей · 2 счёта · €585». Деньги — только когда они
 *  есть: «€0» рядом со счётом читается как ошибка, а не как пустая касса.
 *  Пустой календарь так и говорит. */
export function archivedCalendarCaption(
  calendar: ArchivedCalendar,
  formatMoney: (amount: number) => string,
): string {
  const parts: string[] = [];
  if (calendar.appointments > 0) {
    parts.push(formatCountRu(calendar.appointments, ["запись", "записи", "записей"]));
  }
  if (calendar.accounts > 0) {
    parts.push(formatCountRu(calendar.accounts, ["счёт", "счёта", "счетов"]));
    if (Math.round(calendar.balance * 100) !== 0) parts.push(formatMoney(calendar.balance));
  }
  return parts.length > 0 ? parts.join(" · ") : "Пустой";
}
