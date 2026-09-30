import type { Client } from "@babun/shared/local/clients";
import type { Appointment } from "@babun/shared/local/appointments";

// ЛЕНТА КОМАНД ВКЛАДКИ «КЛИЕНТЫ» (владелец 30.09: «такую же разбивку по
// командам, чтоб клиенты относились к определённой команде»). Чистые
// правила: какие клиенты видны под чипом и в какую команду заводится новый
// клиент. Хранение выбора — `team-pref.ts`.
//
// КЛИЕНТ ОДИН, КОМАНД У НЕГО МОЖЕТ БЫТЬ НЕСКОЛЬКО (владелец 30.09: «клиент
// один, а растягивается сразу на две команды»). Поэтому:
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
 *  (владелец 30.09: «убираем кнопку все, изначально показывает всё»);
 *  это значение хранится, когда ни один чип не нажат. Не id команды:
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

/** Тап по чипу: включает команду, повторный тап по ней же снимает выбор
 *  (владелец 30.09: «если я ещё раз тапну, она снимает»). */
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

/** Какую команду подписать в строке клиента. Без чипа — его свою. Под чипом
 *  — только если своя у него ДРУГАЯ: «клиент Команды 1, которого обслуживала
 *  Команда 3» должен читаться, а подпись выбранной команды у всех подряд —
 *  шум. */
export function rowTeamLabelId(
  client: Pick<Client, "team_id">,
  choice: ClientsTeamChoice,
  fallbackTeamId: string | null = null,
): string | null {
  if (choice === ALL_TEAMS) return client.team_id ?? fallbackTeamId;
  return client.team_id && client.team_id !== choice ? client.team_id : null;
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
