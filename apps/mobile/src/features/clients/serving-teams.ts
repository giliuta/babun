import type { Client } from "@babun/shared/local/clients";
import type { Appointment } from "@babun/shared/local/appointments";

// СПРАВОЧНОЕ У КЛИЕНТА — ТОЛЬКО ОБСЛУЖИВАЮЩИХ ЕГО КАЛЕНДАРЕЙ.
// Метки, теги и прочие варианты выбора на клиенте берутся из календарей,
// которые его обслуживают: его своя команда (`team_id`) и команды его
// неотменённых записей. Календарь в архиве не обслуживает никого, удалённая
// или выключенная строка справочника не предлагается, одно имя внутри набора —
// одна строка. Метки ВСЕХ календарей компании в шторке клиента Y&D
// («Кабинет 1», «Ирина» из архива) — ровно то, чего быть не должно.
//
// Лист без React — проверяется тестом напрямую (`serving-teams.test.ts`).

/** Календари, обслуживающие клиента: своя команда и команды неотменённых
 *  записей, без календарей в архиве. Команда, которой в справочнике нет
 *  (чужая компания), архивом не считается — её строки решает сервер. */
export function servingTeamIds(
  client: Pick<Client, "id" | "team_id">,
  appointments: readonly Pick<Appointment, "team_id" | "client_id" | "status">[],
  archivedTeamIds: ReadonlySet<string>,
): Set<string> {
  const ids = new Set<string>();
  if (client.team_id) ids.add(client.team_id);
  for (const a of appointments) {
    if (a.client_id === client.id && a.team_id && a.status !== "cancelled") ids.add(a.team_id);
  }
  for (const id of archivedTeamIds) ids.delete(id);
  return ids;
}

/** Строка справочника, которую можно предложить: своя команда из набора,
 *  не выключена, не удалена, не скрыта. Поля, которых у справочника нет,
 *  не мешают. */
export function liveRowOfTeams(
  row: {
    team_id: string | null;
    is_active?: boolean | null;
    deleted_at?: string | null;
    hidden?: boolean | null;
  },
  teamIds: ReadonlySet<string>,
): boolean {
  if (!row.team_id || !teamIds.has(row.team_id)) return false;
  if (row.is_active === false) return false;
  if (row.deleted_at) return false;
  return !row.hidden;
}

/** Одно имя — одна строка: у каждого календаря своя «Paphos», а у клиента
 *  метка — имя. Остаётся первая по порядку справочника. */
export function uniqueByName<Row extends { name: string }>(rows: readonly Row[]): Row[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.name.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Метки, которые шторка «Метка клиента» предлагает: обслуживающих
 *  календарей, живые, по одной на имя. */
export function labelsOfferedFor<
  Row extends { name: string; team_id: string | null; is_active?: boolean | null; deleted_at?: string | null },
>(rows: readonly Row[], teamIds: ReadonlySet<string>): Row[] {
  return uniqueByName(rows.filter((row) => liveRowOfTeams(row, teamIds)));
}

/** «ЛЮДИ»: кого можно привязать к карточке-группе. Связь живёт у человека, и
 *  сервер (`client:people_other_team`) пускает её, только когда команда
 *  группы — обслуживающая для человека: его своя или команда его записи.
 *  Группа без команды ничего не запирает; группа календаря в архиве не
 *  обслуживает никого. */
export function linkableToGroup<T extends Pick<Client, "id" | "team_id">>(
  group: Pick<Client, "team_id">,
  clients: readonly T[],
  appointments: readonly Pick<Appointment, "team_id" | "client_id" | "status">[],
  archivedTeamIds: ReadonlySet<string>,
): T[] {
  const team = group.team_id;
  if (!team) return clients as T[];
  if (archivedTeamIds.has(team)) return [];
  const served = new Set<string>();
  for (const a of appointments) {
    if (a.team_id === team && a.client_id && a.status !== "cancelled") served.add(a.client_id);
  }
  return clients.filter((c) => c.team_id === team || served.has(c.id));
}
