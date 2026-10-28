import { useMemo } from "react";
import { useTeamName } from "@/session/team-name";
import type { Client } from "@babun/shared/local/clients";
import type { Appointment } from "@babun/shared/local/appointments";
import { buildStatsMap } from "@babun/shared/local/selectors/client-stats";
import { useClientInvoicing } from "@/features/finances/client-invoicing";
import { useBusinessToday } from "@/features/settings/business-today";
import { statsByBlocks } from "@/features/clients/card-access";
import { useCardFieldsByTeam } from "@/features/clients/card-prefs";
import {
  capabilitiesOf,
  type ClientsCapabilities,
  type ClientsScope,
} from "@/session/clients-company";
import type { GuestSources } from "@/features/clients/guest-sources";
import {
  ALL_TEAMS,
  appointmentsOfTeam,
  clientsOfTeam,
  liveTeamChoice,
  withoutArchivedTeams,
} from "@/features/clients/team-scope";
import { useClientsTeam, useSetClientsTeam } from "@/features/clients/team-pref";
import { useAccessMapOf } from "@/features/clients/use-card-access";
import { useTeams, type Team } from "@/features/reference/queries";
import { dataSpanOf } from "./list-derive";
import type { ListTeam } from "./use-list-merge";

/** The team ribbon: which team is chosen, who may create there, and the
 *  rows, appointments and stats under that choice. */
export function useListTeamScope({
  scope,
  caps,
  guests,
  ownTeams,
  teams,
  clients,
  appointments,
}: {
  scope: ClientsScope | null;
  caps: ClientsCapabilities;
  guests: GuestSources;
  ownTeams: Team[];
  teams: ListTeam[];
  clients: Client[];
  appointments: Appointment[];
}) {
  // ЛЕНТА КОМАНД. Клиент принадлежит команде полем карточки
  // (`team_id`), а не последним визитом. Чипа «Все» нет: ни одна команда не
  // нажата — видны все; тап включает команду, повторный тап снимает. Выбор
  // помнится по компании; исчезнувшая команда снимается сама.
  const { data: savedTeam } = useClientsTeam(scope?.tenantId ?? null);
  const setSavedTeam = useSetClientsTeam(scope?.tenantId ?? null);
  const teamChoice = liveTeamChoice(
    savedTeam,
    teams.map((tm) => tm.id),
  );
  // «СОЗДАТЬ КЛИЕНТА» — В ВЫБРАННУЮ КОМАНДУ (нет доступа — кнопка серая, а не
  // скрыта). Своя команда или «все» — своя база. Команда партнёра на ленте —
  // клиент заводится в ЕЁ компанию, и только при «Создании клиента: Может»
  // в этой команде; иначе кнопка серая. Кнопка, горящая везде, заводила бы
  // клиента в свою базу, хотя на экране чужая команда.
  const chipGuest =
    teamChoice === ALL_TEAMS || ownTeams.some((tm) => tm.id === teamChoice)
      ? null
      : (guests.list.find((guest) => guest.teams.some((tm) => tm.id === teamChoice)) ?? null);
  const chipGuestAccess = useAccessMapOf(chipGuest?.scope);
  const createHere = chipGuest
    ? capabilitiesOf(chipGuest.scope).create &&
      chipGuestAccess?.calendars[teamChoice]?.["clients.create"] === "write"
    : caps.create;
  // Команды компаний-партнёров — ТЕМ ЖЕ ЧИПОМ, что свои (как будто все
  // команды его): граница баз держится данными, а не видом.
  // Имя — тем же правилом, что чип календаря: команда, названная почтой,
  // не обрезается в «babun.app+r…» (`session/team-name.ts`).
  const teamName = useTeamName();
  const teamChips = useMemo(
    () => teams.map((tm) => ({ id: tm.id, name: teamName(tm.name), color: tm.color })),
    [teams, teamName],
  );
  // КЛИЕНТ ОДИН НА НЕСКОЛЬКО КОМАНД (см. `team-scope.ts`): под чипом — свои
  // клиенты команды и те, кого она обслуживала; цифры — по её записям.
  // БЕЗ ЧИПА — ОБЩИЙ СПИСОК ВСЕХ КОМАНД: пока команда не выбрана, видны все
  // команды; выбрал свою — только свои клиенты. Клиенты партнёра стоят в общем списке, но их строки
  // по-прежнему такие, какими их отдал сервер (без номеров и денег по
  // правам), а выбрать их для выгрузки и рассылки нельзя (`selectable`).
  // КЛИЕНТЫ КОМАНД В АРХИВЕ ПОД «ВСЕ» НЕ СТОЯТ (`withoutArchivedTeams`):
  // чипа у архивной команды нет, и её «Тест» висели в общем списке ничьими.
  const { data: companyTeams = [] } = useTeams({ includeInactive: true });
  const archivedTeamIds = useMemo(
    () => new Set(companyTeams.filter((tm) => !tm.is_active).map((tm) => tm.id)),
    [companyTeams],
  );
  const teamClients = useMemo(
    () =>
      teamChoice === ALL_TEAMS
        ? withoutArchivedTeams(clients, archivedTeamIds, appointments)
        : clientsOfTeam(clients, teamChoice, appointments),
    [clients, teamChoice, appointments, archivedTeamIds],
  );
  const teamAppointments = useMemo(
    () => appointmentsOfTeam(appointments, teamChoice),
    [appointments, teamChoice],
  );
  // Деньги чужой компании сотруднику не приходят вовсе — в строке их нет.
  // «ЧТО ПОКАЗЫВАТЬ НА КАРТОЧКЕ» — У КОМАНДЫ: строка
  // клиента берёт набор СВОЕЙ команды клиента, пока та ничего не меняла —
  // общий набор.
  const teamIdList = useMemo(() => teams.map((tm) => tm.id), [teams]);
  const cardFieldsFor = useCardFieldsByTeam(teamIdList);

  // Per-client roll-up (visits / money / debt / last team) — one pass
  // over appointments, shared by the cards, the sort and the filter.
  // Под чипом команды строка, сортировка и фильтры считают ТОЛЬКО её записи.
  // Полная история нужна там, где решается судьба клиента: можно ли его
  // удалить и что уйдёт в выгрузку, — там `allStatsMap`.
  // Долг строки — правилом «Финансов»: работа под инвойсом должна остаток
  // инвойса; инвойс без записи под чипом команды — только своей.
  const invoicing = useClientInvoicing();
  const teamInvoicing = useClientInvoicing(teamChoice === ALL_TEAMS ? null : teamChoice);
  const today = useBusinessToday();
  const allStatsMap = useMemo(
    () => buildStatsMap(clients, appointments, invoicing, today),
    [clients, appointments, invoicing, today],
  );
  const teamStatsMap = useMemo(
    () =>
      teamChoice === ALL_TEAMS
        ? null
        : buildStatsMap(teamClients, teamAppointments, teamInvoicing, today),
    [teamChoice, teamClients, teamAppointments, teamInvoicing, today],
  );
  // Деньги и визиты строки — по правам этого клиента: у сотрудника
  // сводка из видимых записей не должна показывать то, что закрыто в
  // карточке, ни в строке, ни в сортировке, ни в фильтрах.
  const statsMap = useMemo(() => {
    const base = teamStatsMap ?? allStatsMap;
    if (!clients.some((c) => c.blocks)) return base;
    const masked = new Map(base);
    for (const c of clients) {
      const s = base.get(c.id);
      if (s && c.blocks) masked.set(c.id, statsByBlocks(c, s));
    }
    return masked;
  }, [teamStatsMap, allStatsMap, clients]);

  // Первая и последняя (не отменённые) записи — сплит периода в фильтрах
  // показывает у «Всего времени» честный охват данных в обе стороны.
  const dataSpan = useMemo(() => dataSpanOf(teamAppointments), [teamAppointments]);

  return {
    teamChoice,
    setSavedTeam,
    chipGuest,
    createHere,
    teamChips,
    teamClients,
    teamAppointments,
    cardFieldsFor,
    allStatsMap,
    statsMap,
    dataSpan,
  };
}
