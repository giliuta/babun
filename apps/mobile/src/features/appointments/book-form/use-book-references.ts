import { useMemo } from "react";
import { buildStatsMap } from "@babun/shared/local/selectors/client-stats";
import { useClientInvoicing } from "@/features/finances/client-invoicing";
import { useBusinessToday } from "@/features/settings/business-today";
import { useClients } from "@/features/clients/queries";
import { useAllServices, useServices } from "@/features/services/queries";
import { useMasters, useTeams } from "@/features/reference/queries";
import { useAppointments } from "@/features/calendar/queries";
import { useBookingSave } from "@/features/appointments/useBookingSave";
import {
  useCalendarSettings,
  usePersonalEventTypes,
} from "@/features/settings/local-settings";
import {
  lastCreatedTeamId,
  recentClientIdsOf,
} from "./booking-history";

/** Reference data of the booking form and what is derived from it. */
export function useBookReferences(teamId: string | null) {
  // ── справочные данные (кеш уже тёплый — календарь грузит те же ключи) ──
  const teamsQuery = useTeams();
  // Весь справочник, с архивом — только чтобы назвать календарь записи,
  // ушедшей в архив. Ключ общий с `teamsQuery`: сети это не добавляет.
  const { data: allTeams = [] } = useTeams({ includeInactive: true });
  const mastersQuery = useMasters();
  const servicesQuery = useServices();
  // Услуга типа «варианты» продаётся выбором объёма работ, а не количеством:
  // трёхкомнатная квартира — это не «три раза комната».
  const clientsQuery = useClients();
  const appointmentsQuery = useAppointments();
  const calendarSettingsQuery = useCalendarSettings();
  // Типы событий ЭТОЙ команды.
  const eventTypesQuery = usePersonalEventTypes(teamId);
  const teams = useMemo(() => teamsQuery.data ?? [], [teamsQuery.data]);
  const masters = useMemo(() => mastersQuery.data ?? [], [mastersQuery.data]);
  const services = useMemo(() => servicesQuery.data ?? [], [servicesQuery.data]);
  const clients = useMemo(() => clientsQuery.data ?? [], [clientsQuery.data]);
  const allAppts = useMemo(
    () => appointmentsQuery.data ?? [],
    [appointmentsQuery.data],
  );
  // ВВОДНАЯ О КАЖДОМ КЛИЕНТЕ — ОДНОЙ КАРТОЙ НА ВЕСЬ СПИСОК. `buildStats` на
  // строку превратил бы выбор клиента в квадрат по числу записей.
  // Работа под инвойсом должна остаток инвойса — как в списке клиентов.
  const invoicing = useClientInvoicing();
  const today = useBusinessToday();
  const statsById = useMemo(
    () => buildStatsMap(clientsQuery.data ?? [], allAppts, invoicing, today),
    [clientsQuery.data, allAppts, invoicing, today],
  );
  const calendarSettings = calendarSettingsQuery.data;
  // Создание заявки и весь его хвост (синхронизация push события, тосты,
  // хаптика) живут в общем хуке — на нём же строится
  // шторка «Записать» с карточки клиента, чтобы путь создания остался один.
  const booking = useBookingSave();
  // «ЕЩЁ НЕТ ДАННЫХ», А НЕ «ИДЁТ ЗАПРОС». `isLoading` ложно, пока запрос
  // выключен (роль ещё не доехала) — и эффекты дефолтов срабатывали по
  // ПУСТОМУ списку: команда из ссылки «не находилась» и обнулялась, клиент
  // из диплинка сбрасывался, и цепочка открывала выбор клиента поверх
  // записи, у которой клиент был назван. Ловилось только на холодном кэше —
  // после полной перезагрузки бандла. `isPending`
  // истинно, пока данных нет вовсе, — ровно то, чего эффекты ждут.
  const teamsLoading = teamsQuery.isPending;
  const clientsLoading = clientsQuery.isPending;

  const catalog = useMemo(
    () => new Map(services.map((s) => [s.id, s])),
    [services],
  );
  // ИМЯ РАБОТЫ ЖИВЁТ ДОЛЬШЕ САМОЙ УСЛУГИ. `catalog` — про выбор и цену новых
  // строк, и он справедливо не знает убранных из прайса; но запись, в которой
  // услуга стоит с мая, обязана называть её по имени. Тот же справочник, что
  // держала карточка записи.
  const { data: allServices = [] } = useAllServices();
  const nameById = useMemo(
    () => new Map(allServices.map((s) => [s.id, s.name])),
    [allServices],
  );
  // Цвет — по тому же ПОЛНОМУ справочнику, а не по живому каталогу: правка
  // старой записи с убранной из прайса услугой красила бы форму одним цветом,
  // а сетку другим, — ровно та тихая ложь, о которой предупреждает соседний
  // комментарий.
  const serviceColorById = useMemo(
    () => new Map(allServices.map((s) => [s.id, s.color])),
    [allServices],
  );

  // ── умные дефолты из истории (как старый шит) ──
  const lastTeamId = useMemo(() => lastCreatedTeamId(allAppts, teams), [allAppts, teams]);

  const recentClientIds = useMemo(() => recentClientIdsOf(allAppts), [allAppts]);

  // Прайс ВЫБРАННОЙ команды: услуга принадлежит ровно одной команде.
  // Пока команда не выбрана, каталог пуст — см.
  // `isServiceAllowedForTeam`.
  const teamServices = useMemo(
    () => services.filter((s) => teamId != null && s.team_id === teamId),
    [services, teamId],
  );
  // «ЧАСТЫЕ УСЛУГИ» ПИЛЮЛЯМИ НЕТ. Пилюли в блоке услуг и в листе выбора были бы тем же
  // прайсом, набранным второй раз другой вёрсткой, — список услуг открывается одним тапом и говорит цену и
  // длительность, а пилюля не говорит ничего.

  return {
    teamsQuery,
    allTeams,
    mastersQuery,
    servicesQuery,
    clientsQuery,
    appointmentsQuery,
    calendarSettingsQuery,
    eventTypesQuery,
    teams,
    masters,
    services,
    clients,
    allAppts,
    statsById,
    calendarSettings,
    booking,
    teamsLoading,
    clientsLoading,
    catalog,
    nameById,
    serviceColorById,
    lastTeamId,
    recentClientIds,
    teamServices,
  };
}

export type BookReferences = ReturnType<typeof useBookReferences>;
