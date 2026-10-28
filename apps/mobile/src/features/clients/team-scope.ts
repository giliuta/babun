import type { Client } from "@babun/shared/local/clients";
import type { Appointment } from "@babun/shared/local/appointments";

// ЛЕНТА КОМАНД ВКЛАДКИ «КЛИЕНТЫ»: клиенты относятся к определённой команде.
// Чистые
// правила: какие клиенты видны под чипом и в какую команду заводится новый
// клиент. Хранение выбора — `team-pref.ts`.
//
// КЛИЕНТ ОДИН, КОМАНД У НЕГО МОЖЕТ БЫТЬ НЕСКОЛЬКО. Поэтому:
//   • карточка у клиента одна, и `team_id` — его СВОЯ команда (кто ведёт
//     клиента, туда он заводится); сама по себе она не меняется;
//   • каждая запись остаётся у той команды, что её сделала, — вместе с
//     деньгами и долгом (`records_stay_in_their_team`);
//   • под чипом команды видны её клиенты И клиенты, которых она обслуживала
//     или к кому записана, — так же, как их видит сотрудник этой команды на
//     сервере (`access_client_ids_in`);
//   • цифры строки под чипом — только по записям этой команды: 1-го числа
//     обслужила «Команда 1», 2-го — «Команда 3», и каждая видит свой визит и
//     свои деньги, а без чипа — видно всё.

/** «Команда не выбрана» — видны все клиенты. Чипа «Все» в ленте нет
 *  (по умолчанию показано всё); это значение хранится, когда ни один чип не нажат. Не id команды:
 *  команды зовутся `team-…`. */
export const ALL_TEAMS = "all";

export type ClientsTeamChoice = typeof ALL_TEAMS | string;

/** Выбор, который ещё можно показать: удалённая или чужая команда
 *  возвращает ленту на «Все», а не прячет весь список за пустым чипом. */
export function liveTeamChoice(
  saved: string | null | undefined,
  teamIds: readonly string[],
): ClientsTeamChoice {
  return saved && saved !== ALL_TEAMS && teamIds.includes(saved) ? saved : ALL_TEAMS;
}

/** Тап по чипу: включает команду, повторный тап по ней же снимает выбор. */
export function toggleTeamChoice(
  current: ClientsTeamChoice,
  tapped: string,
): ClientsTeamChoice {
  return current === tapped ? ALL_TEAMS : tapped;
}

/** Записи, которые считаются под чипом: без чипа — все, под чипом — только
 *  этой команды. Отменённые не выкидываются здесь: их отсекает статистика. */
export function appointmentsOfTeam<T extends Pick<Appointment, "team_id">>(
  appointments: readonly T[],
  choice: ClientsTeamChoice,
): T[] {
  if (choice === ALL_TEAMS) return appointments as T[];
  return appointments.filter((a) => a.team_id === choice);
}

/** Клиенты под выбранным чипом. Без чипа — вся склейка, включая клиентов
 *  без команды (компания без команд) и клиентов других компаний. Под чипом —
 *  свои клиенты команды и те, у кого с ней есть неотменённая запись. */
export function clientsOfTeam<T extends Pick<Client, "id" | "team_id">>(
  clients: readonly T[],
  choice: ClientsTeamChoice,
  appointments: readonly Pick<Appointment, "team_id" | "client_id" | "status">[] = [],
): T[] {
  if (choice === ALL_TEAMS) return clients as T[];
  const served = new Set<string>();
  for (const a of appointments) {
    if (a.team_id === choice && a.client_id && a.status !== "cancelled") served.add(a.client_id);
  }
  return clients.filter((c) => c.team_id === choice || served.has(c.id));
}

/** «Все» без клиентов команд в архиве. Архивный календарь выведен из живого
 *  продукта (его деньги не существуют в живых «Финансах»), и его клиенты под
 *  «Все» стояли бы без своего чипа. Клиента это не удаляет: календарь вернули
 *  из архива — клиент снова в списке. Клиент, которого обслуживала живая
 *  команда, остаётся: он и под её чипом. */
export function withoutArchivedTeams<T extends Pick<Client, "id" | "team_id">>(
  clients: readonly T[],
  archivedTeamIds: ReadonlySet<string>,
  appointments: readonly Pick<Appointment, "team_id" | "client_id" | "status">[] = [],
): T[] {
  if (archivedTeamIds.size === 0) return clients as T[];
  const servedByLive = new Set<string>();
  for (const a of appointments) {
    if (a.client_id && a.team_id && !archivedTeamIds.has(a.team_id) && a.status !== "cancelled") {
      servedByLive.add(a.client_id);
    }
  }
  return clients.filter(
    (c) => !c.team_id || !archivedTeamIds.has(c.team_id) || servedByLive.has(c.id),
  );
}

/** Команда нового клиента: выбранная в ленте, иначе первая команда.
 *  Прямая офлайн-запись умолчания сервера не знает, поэтому пусто уходит
 *  только у компании без команд. */
export function teamForNewClient(
  choice: ClientsTeamChoice,
  teamIds: readonly string[],
): string | null {
  if (choice !== ALL_TEAMS && teamIds.includes(choice)) return choice;
  return teamIds[0] ?? null;
}

/** Ссылка «Создать клиента» с командой чипа. Без `team` карточка выбирала
 *  команду по сохранённому чипу ЭТОЙ компании, и у чужой (партнёрской)
 *  команды клиент заводился в первую команду — не в ту, что на экране.
 *  «Все» команду не называет: решает прежнее правило. */
export function withNewClientTeam<P extends { params: object }>(
  href: P,
  choice: ClientsTeamChoice,
): P {
  if (choice === ALL_TEAMS) return href;
  return { ...href, params: { ...href.params, team: choice } };
}
