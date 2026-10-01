import { Fragment, useMemo, useState, type ReactNode } from "react";
import { ScrollView } from "react-native";
import { useRouter, type Href } from "expo-router";
import {
  Archive,
  CalendarClock,
  Download,
  Eye,
  Home,
  MessageCircle,
  Navigation,
  Tags,
  Smartphone,
  Trash2,
  Upload,
} from "lucide-react-native";
import { TRASH_DAYS } from "@babun/shared/db/repositories/clients";
import { Screen } from "@/components/ui/Screen";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { CONTACTS_AVAILABLE } from "@/features/clients/import/ContactsImportSheet";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { Divider } from "@/components/ui/Divider";
import { useToast } from "@/components/ui/Toast";
import {
  DEFAULT_CARD_FIELDS,
  useCardFields,
} from "@/features/clients/card-prefs";
import {
  contactWayDef,
  useEnabledWays,
} from "@/features/clients/contact-ways";
import {
  mapServicesSummary,
  useEnabledMapServices,
} from "@/lib/map-services";
import { shareClientsCsv } from "@/features/clients/bulk-export";
import { useClients, useClientTags } from "@/features/clients/queries";
import { useAppointments } from "@/features/calendar/queries";
import { buildStatsMap } from "@babun/shared/local/selectors/client-stats";
import { ClientsCompanyRoute } from "@/features/clients/ClientsCompanyRoute";
import {
  ClientsScopeProvider,
  useClientsCapabilities,
  useClientsScopeOrNull,
} from "@/features/clients/company-scope";
import type { ClientsScope } from "@/features/clients/clients-company";
import { useAccessMaps, useClientsSources } from "@/features/clients/sources";
import { useGuestSources } from "@/features/clients/guest-sources";
import { useMyAccess } from "@/features/access/queries";
import { useTenantId } from "@/lib/tenant";
import { EmptyState } from "@/components/ui/EmptyState";
import { ScopeChips } from "@/components/ui/ScopeChips";
import { useTeams } from "@/features/reference/queries";
import { useClientsTeam, useSetClientsTeam } from "@/features/clients/team-pref";
import { ALL_TEAMS, clientsOfTeam } from "@/features/clients/team-scope";
import { useFeatureOn } from "@/features/settings/company-features";
import { useLocationLabels } from "@/features/settings/local-settings";
import {
  useClientFunctionOn,
  type ClientFunctionKey,
} from "@/features/clients/client-functions";
import {
  SERVICE_MONTH_CHOICES,
  serviceMonthsLabel,
} from "@/features/clients/service-default";
import { useTeamServiceMonths } from "@/features/clients/use-service-default";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { anyClientSetting, clientSettingLevels } from "@/features/clients/settings-levels";
import { useClientSettingLevelsOf } from "@/features/clients/use-client-settings";
import { useThemeColors } from "@/theme/colors";

// Подпись «Карточки клиента» называет выключенные блоки теми же словами,
// что строки на её странице.
const BLOCK_WORDS: [ClientFunctionKey, string][] = [
  ["client_note", "заметка"],
  ["client_people", "люди"],
  ["client_objects", "объекты"],
  ["client_files", "файлы"],
  ["client_requisites", "реквизиты"],
  ["client_labels", "метка и тег"],
  ["client_personal", "личное"],
];

// v811 — «Настройки клиентов». Открывается шестерёнкой из хедера списка
// (порт web ClientsSettingsScreen). Группы:
//   • Отображение — Что показывать (live card-fields) · Теги клиентов.
//     Сортировка ЗДЕСЬ НЕ живёт: она первая строка листа «Фильтры»
//     (решение владельца 2026-07-25), персист в sort-pref.ts.
//   • Данные — Импорт CSV (мастер ImportWizardSheet: выбор файла →
//     маппинг колонок → превью+валидация → импорт с прогрессом/резюмом).
//     Экспорт CSV выполняется через системный share sheet.

// Экран вкладки «Клиенты»: компанию называет источник, а не роль
// (STORY-082).
export default function ClientsSettingsScreenRoute() {
  return (
    <ClientsCompanyRoute kind="tab">
      <ClientsSettingsScreen />
    </ClientsCompanyRoute>
  );
}

function ClientsSettingsScreen() {
  const activeTenantId = useTenantId();
  const routeScope = useClientsScopeOrNull();
  const caps = useClientsCapabilities();
  // У КАЖДОЙ КОМАНДЫ СВОИ НАСТРОЙКИ КЛИЕНТОВ (владелец 30.09), как у
  // настроек календаря: лента команд наверху, строки правят выбранную.
  // ЛЕНТА — СВОИ КОМАНДЫ И КОМАНДЫ РАБОТОДАТЕЛЕЙ (01.10): партнёр со своей
  // компанией видел здесь только её; теперь рядом стоят команды, где ему
  // открыли хоть одну строку «Настроек клиентов», — тем же чипом, что свои.
  // Всё под лентой читается и пишется в компании выбранной команды.
  const { data: ownTeams = [] } = useTeams();
  const { data: listTeam } = useClientsTeam(ownTeams[0]?.tenant_id ?? null);
  const sources = useClientsSources();
  const memberScopes = useMemo(
    () => sources.list.filter((source) => source.kind === "member"),
    [sources.list],
  );
  const guests = useGuestSources(memberScopes);
  const activeMap = useMyAccess().data;
  const foreignIds = useMemo(
    () => memberScopes.map((s) => s.tenantId).filter((id) => id !== activeTenantId),
    [memberScopes, activeTenantId],
  );
  const foreignMaps = useAccessMaps(foreignIds);
  const ribbon = useMemo(() => {
    const out: { id: string; name: string; color: string | null; scope: ClientsScope }[] = [];
    if (caps.manage && routeScope) {
      for (const tm of ownTeams) out.push({ id: tm.id, name: tm.name, color: tm.color, scope: routeScope });
    }
    for (const guest of guests.list) {
      const map =
        guest.scope.tenantId === activeTenantId ? activeMap : foreignMaps.get(guest.scope.tenantId);
      for (const tm of guest.teams) {
        const levels = clientSettingLevels({
          own: false,
          member: true,
          role: guest.scope.role,
          map,
          teamId: tm.id,
        });
        if (anyClientSetting(levels)) {
          out.push({ id: tm.id, name: tm.name, color: tm.color ?? null, scope: guest.scope });
        }
      }
    }
    return out;
  }, [caps.manage, routeScope, ownTeams, guests.list, activeTenantId, activeMap, foreignMaps]);
  const [pickedTeam, setPickedTeam] = useState<string | null>(null);
  const entry =
    ribbon.find((tm) => tm.id === pickedTeam) ??
    (listTeam && listTeam !== ALL_TEAMS ? ribbon.find((tm) => tm.id === listTeam) : undefined) ??
    ribbon[0] ??
    null;

  return (
    <Screen>
      <ScreenHeader
        title="Настройки клиентов"
        // Шов несёт лента команд; без неё линию берёт шапка (как в
        // настройках календаря).
        seam={!entry}
      />
      {entry ? (
        <ScopeChips
          items={ribbon.map((tm) => ({ id: tm.id, name: tm.name, color: tm.color }))}
          activeId={entry.id}
          onSelect={setPickedTeam}
        />
      ) : null}
      {entry ? (
        // Компания выбранной команды — источник тела: хуки настроек читают и
        // пишут её, а подстраницы уносят её в адресе.
        <ClientsScopeProvider scope={entry.scope}>
          <SettingsBody
            key={entry.id}
            teamId={entry.id}
            tenantParam={entry.scope.tenantId !== routeScope?.tenantId ? entry.scope.tenantId : null}
          />
        </ClientsScopeProvider>
      ) : (
        // Строк не открыли ни одной: страница остаётся собой, а тело
        // говорит одной строкой — без подписи и без кнопки (канон пустых
        // состояний, LOCKED 2026-08-27).
        <EmptyState fill title="Настроек пока нет" />
      )}
    </Screen>
  );
}

function SettingsBody({ teamId, tenantParam }: { teamId: string; tenantParam: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const t = useThemeColors();
  // ХОЗЯЙСТВО БАЗЫ («Данные») — только своей компании (владелец 20.09).
  const caps = useClientsCapabilities();
  const objectsOn = useFeatureOn("objects");
  const { data: ownTeams = [] } = useTeams();
  const setListTeam = useSetClientsTeam(ownTeams[0]?.tenant_id ?? null);
  const levels = useClientSettingLevelsOf()(teamId);
  const teamHref = (pathname: string): Href =>
    ({ pathname, params: tenantParam ? { team: teamId, tenant: tenantParam } : { team: teamId } }) as Href;
  // Функции клиентов — у команды (владелец 30.09: «люди, связи, реквизиты,
  // файлы — всё закреплено за командой»).
  const blockOn: Record<ClientFunctionKey, boolean> = {
    client_note: useClientFunctionOn("client_note", teamId),
    client_people: useClientFunctionOn("client_people", teamId),
    client_objects: useClientFunctionOn("client_objects", teamId),
    client_files: useClientFunctionOn("client_files", teamId),
    client_requisites: useClientFunctionOn("client_requisites", teamId),
    client_labels: useClientFunctionOn("client_labels", teamId),
    client_personal: useClientFunctionOn("client_personal", teamId),
  };
  // Объекты, выключенные у компании, в подписи не числятся: их строки на
  // странице блоков нет вовсе.
  const offBlocks = BLOCK_WORDS.filter(
    ([key]) => !blockOn[key] && (key !== "client_objects" || objectsOn),
  ).map(([, word]) => word);
  // Интервал обслуживания объектов — у команды (владелец 30.09).
  const service = useTeamServiceMonths(teamId);
  const [servicePicker, setServicePicker] = useState(false);
  const { data: prefs = DEFAULT_CARD_FIELDS } = useCardFields(teamId);
  // Подпись «Типов объектов» — настоящие типы команды, а не образец.
  const { data: teamObjectTypes = [] } = useLocationLabels(teamId);
  const objectTypeNames = teamObjectTypes.map((label) => label.name);
  const rowFieldsOn = Object.values(prefs).filter(Boolean).length;
  const cardSub = [
    offBlocks.length === 0 ? "Все блоки" : `Без: ${offBlocks.join(", ")}`,
    `в строке ${rowFieldsOn} из ${Object.keys(prefs).length}`,
  ].join(" · ");
  const clientsQuery = useClients();
  const tagsQuery = useClientTags();
  const clients = useMemo(() => clientsQuery.data ?? [], [clientsQuery.data]);
  // Долг для выгрузки считается тем же селектором, что везде.
  const { data: appointmentsForStats = [] } = useAppointments();
  const statsMap = useMemo(
    () => buildStatsMap(clients, appointmentsForStats),
    [clients, appointmentsForStats],
  );
  const tags = useMemo(() => tagsQuery.data ?? [], [tagsQuery.data]);
  // Теги — у команды (30.09): счётчик строки — теги выбранной команды.
  const teamTags = useMemo(
    () => (teamId ? tags.filter((tag) => !tag.team_id || tag.team_id === teamId) : tags),
    [tags, teamId],
  );
  // ДАННЫЕ — ТОЖЕ У КОМАНДЫ (владелец 30.09): выгрузка, архив и корзина — её
  // клиенты (свои и те, кого она обслуживала, как под чипом списка), импорт —
  // в неё.
  const teamClients = useMemo(
    () => (teamId ? clientsOfTeam(clients, teamId, appointmentsForStats) : clients),
    [clients, teamId, appointmentsForStats],
  );

  // Карты для маршрута: у кого-то весь навигатор — Google, и Яндекс в листе
  // только удлиняет каждый выезд (владелец 2026-08-02).
  const mapServices = useEnabledMapServices(teamId);
  // Чем вообще связываются с клиентом — один набор на кнопку у номера и на
  // плюс в карточке.
  const enabledWays = useEnabledWays(teamId);

  // Возврат на список с nonce-параметром — index открывает нужный шит.
  // Импорт идёт в команду, выбранную здесь: список открывается на ней, и
  // его лист импорта берёт команду из ленты.
  const backToList = (param: "openImport" | "openContacts") => {
    if (teamId) setListTeam.mutate(teamId);
    router.navigate({
      pathname: "/clients",
      params: { [param]: String(Date.now()) },
    });
  };

  const exportAll = async () => {
    try {
      if (clientsQuery.isLoading || tagsQuery.isLoading) {
        toast("Данные клиентов ещё загружаются", "info");
        return;
      }
      let exportClients = teamClients;
      let exportTags = tags;
      if (clientsQuery.isError || tagsQuery.isError) {
        const [clientResult, tagResult] = await Promise.all([
          clientsQuery.refetch(),
          tagsQuery.refetch(),
        ]);
        if (clientResult.error) throw clientResult.error;
        if (tagResult.error) throw tagResult.error;
        exportClients = teamId
          ? clientsOfTeam(clientResult.data ?? [], teamId, appointmentsForStats)
          : (clientResult.data ?? []);
        exportTags = tagResult.data ?? [];
      }
      if (exportClients.length === 0) {
        toast("Нет клиентов для выгрузки", "info");
        return;
      }
      const shared = await shareClientsCsv(exportClients, exportTags, statsMap);
      if (shared)
        toast(`Выгружено клиентов: ${exportClients.length}`, "success");
    } catch (error) {
      toast(
        (error as Error).message || "Не удалось выгрузить клиентов",
        "error",
      );
    }
  };

  return (
    <>
      {anyClientSetting(levels) ? (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 24 }}
        >
          {/* СТРОКА — ПО ЕЁ ПРАВУ В ЭТОЙ КОМАНДЕ (владелец 01.10): «Скрыты» —
              строки нет, «Только видит» — страница открывается без правки. */}
          <SettingsGroup
            title="Отображение"
            rows={[
              levels.card !== "hidden" ? (
                <SettingsRow
                  key="card"
                  tile={SETTINGS_TILE.blue}
                  icon={Eye}
                  // «КАРТОЧКА КЛИЕНТА», А НЕ «ЧТО ПОКАЗЫВАТЬ» (владелец 30.09:
                  // «сделай то же самое, как в записи»): блоки страницы клиента
                  // и строка списка — одна страница, как «Записи».
                  title="Карточка клиента"
                  sub={cardSub}
                  onPress={() => router.push(teamHref("/clients/card-fields"))}
                />
              ) : null,
              levels.ways !== "hidden" ? (
                <SettingsRow
                  key="ways"
                  tile={SETTINGS_TILE.green}
                  icon={MessageCircle}
                  title="Способы связи"
                  // НАБОР ОДИН, И ПОДПИСЬ ОДНА (владелец 2026-09-04: «зачем
                  // „можно добавить в карточку“ или „у номера“ — немного
                  // странно»). Раньше строка складывала два списка —
                  // перечисление каналов и счётчик полей — и читалась как каша
                  // из двух настроек.
                  sub={enabledWays
                    .map((id) => contactWayDef(id)?.label)
                    .filter(Boolean)
                    .join(" · ")}
                  onPress={() => router.push(teamHref("/clients/channels"))}
                />
              ) : null,
              levels.maps !== "hidden" ? (
                <SettingsRow
                  key="maps"
                  tile={SETTINGS_TILE.blue}
                  icon={Navigation}
                  title="Карты для маршрута"
                  sub={mapServicesSummary(mapServices)}
                  onPress={() => router.push(teamHref("/clients/maps"))}
                />
              ) : null,
            ]}
          />

          {/* СПРАВОЧНИКИ — то, из чего собирается карточка: типы объектов
              («Вилла», «Дом»), теги. Владелец 2026-08-02: «всё, что можно
              делать в клиентах, потом редактировать и исправлять». Экраны
              справочников общие с Кабинетом — заводить вторые не нужно, нужен
              вход отсюда, из места, где ими пользуются. С 30.09 всё здесь —
              у команды, выбранной лентой. Выключенные у компании объекты
              уносят и свой справочник. */}
          <SettingsGroup
            title="Справочники"
            rows={[
              objectsOn && levels.objects !== "hidden" ? (
                <SettingsRow
                  key="objects"
                  tile={SETTINGS_TILE.teal}
                  icon={Home}
                  title="Типы объектов"
                  sub={
                    objectTypeNames.length > 0
                      ? objectTypeNames.join(", ")
                      : "Добавить первый тип"
                  }
                  onPress={() => router.push(teamHref("/clients/object-types"))}
                />
              ) : null,
              // Раз в сколько месяцев обслуживать объект без своего
              // интервала: на нём держится фильтр «Пора обслужить». Право то
              // же, что у типов объектов; «Только видит» — значение без двери.
              objectsOn && levels.objects !== "hidden" ? (
                <SettingsRow
                  key="service"
                  tile={SETTINGS_TILE.orange}
                  icon={CalendarClock}
                  title="Обслуживание объектов"
                  sub={serviceMonthsLabel(service.months)}
                  onPress={levels.objects === "write" ? () => setServicePicker(true) : undefined}
                />
              ) : null,
              levels.tags !== "hidden" ? (
                <SettingsRow
                  key="tags"
                  tile={SETTINGS_TILE.purple}
                  icon={Tags}
                  title="Теги клиентов"
                  sub={
                    tagsQuery.isLoading
                      ? "Загрузка…"
                      : tagsQuery.isError
                        ? "Не удалось загрузить"
                        : teamTags.length > 0
                          ? `Создано: ${teamTags.length}`
                          : levels.tags === "write"
                            ? "Создать первый тег"
                            : "Тегов пока нет"
                  }
                  onPress={() => router.push(teamHref("/clients/tags"))}
                />
              ) : null,
            ]}
          />

          {/* ДАННЫЕ — ХОЗЯЙСТВО СВОЕЙ БАЗЫ: импорт, выгрузка, архив и
              корзина. Партнёру их нет (выгрузка — «без передачи», 30.09). */}
          {caps.manage ? (
            <SettingsGroup
              title="Данные"
              rows={[
                // Контакты телефона — первый способ, а не второй: у малого
                // сервиса база лежит именно там, а CSV требует сначала
                // где-то собрать таблицу, то есть не сделать никогда. В
                // сборке без нативного модуля строки нет вовсе.
                CONTACTS_AVAILABLE ? (
                  <SettingsRow
                    key="contacts"
                    tile={SETTINGS_TILE.blue}
                    icon={Smartphone}
                    title="Из контактов телефона"
                    sub="Выбрать, кого добавить"
                    onPress={() => backToList("openContacts")}
                  />
                ) : null,
                <SettingsRow
                  key="import"
                  tile={SETTINGS_TILE.blue}
                  icon={Upload}
                  title="Импорт из CSV"
                  sub="Загрузить клиентов из файла"
                  onPress={() => backToList("openImport")}
                />,
                <SettingsRow
                  key="export"
                  tile={SETTINGS_TILE.green}
                  icon={Download}
                  title="Выгрузить клиентов"
                  sub={
                    clientsQuery.isLoading
                      ? "Загрузка…"
                      : clientsQuery.isError
                        ? "Повторить загрузку и выгрузить"
                        : `${teamClients.length} в CSV`
                  }
                  onPress={() => void exportAll()}
                />,
                <SettingsRow
                  key="archive"
                  tile="neutral"
                  icon={Archive}
                  title="Архив клиентов"
                  sub="Убраны из работы, история цела"
                  onPress={() => router.push(teamHref("/clients/archive"))}
                />,
                // Две полки рядом и подписаны по-разному: архив — без срока,
                // корзина — со счётчиком. Иначе «куда он делся» повторится,
                // уже с двумя одинаковыми на вид дверями.
                <SettingsRow
                  key="trash"
                  tile={SETTINGS_TILE.red}
                  icon={Trash2}
                  title="Недавно удалённые"
                  sub={`Хранятся ${TRASH_DAYS} дней, потом стираются`}
                  onPress={() => router.push(teamHref("/clients/trash"))}
                />,
              ]}
            />
          ) : null}
        </ScrollView>
      ) : (
        // Строк не открыли ни одной: страница остаётся собой, а тело
        // говорит одной строкой — без подписи и без кнопки (канон пустых
        // состояний, LOCKED 2026-08-27).
        <EmptyState fill title="Настроек пока нет" />
      )}

      <PickerSheet
        visible={servicePicker}
        title="Обслуживание объектов"
        subtitle="Отсчёт — от последнего визита на объект"
        selectedId={String(service.months ?? "off")}
        items={SERVICE_MONTH_CHOICES.map((months) => ({
          id: String(months ?? "off"),
          label: serviceMonthsLabel(months),
          icon: CalendarClock,
          color: t.accent,
          onPress: () => {
            setServicePicker(false);
            if (months !== service.months) service.set(months);
          },
        }))}
        onClose={() => setServicePicker(false)}
      />

    </>
  );
}

/** Группа шестерёнки: шапка и карточка строк, швы — только между теми, что
 *  остались. Пустая группа не рисуется вовсе — ни шапки, ни белой полосы. */
function SettingsGroup({ title, rows }: { title: string; rows: ReactNode[] }) {
  const shown = rows.filter(Boolean);
  if (shown.length === 0) return null;
  return (
    <>
      <SectionEyebrow>{title}</SectionEyebrow>
      <SectionCard>
        {shown.map((row, index) => (
          <Fragment key={index}>
            {index > 0 ? <Divider inset={56} /> : null}
            {row}
          </Fragment>
        ))}
      </SectionCard>
    </>
  );
}
