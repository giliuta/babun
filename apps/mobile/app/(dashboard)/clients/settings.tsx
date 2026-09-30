import { useMemo, useState } from "react";
import { ScrollView } from "react-native";
import { useRouter, type Href } from "expo-router";
import {
  Archive,
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
import { useClientsCapabilities } from "@/features/clients/company-scope";
import { EmptyState } from "@/components/ui/EmptyState";
import { ScopeChips } from "@/components/ui/ScopeChips";
import { useTeams } from "@/features/reference/queries";
import { useClientsTeam, useSetClientsTeam } from "@/features/clients/team-pref";
import { ALL_TEAMS, clientsOfTeam } from "@/features/clients/team-scope";
import { useFeatureOn } from "@/features/settings/company-features";
import { useLocationLabels } from "@/features/settings/local-settings";
import { useClientFunctionOn } from "@/features/clients/client-functions";

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
  const router = useRouter();
  const toast = useToast();
  // ХОЗЯЙСТВО БАЗЫ — У ТОГО, ЧЬЯ БАЗА (владелец 20.09: «в клиентах оно
  // открывает в любом случае настройки МОИХ клиентов»). Дверь открыта всем,
  // но у человека без своей компании править здесь нечего: страница остаётся
  // собой, а тело говорит одной строкой.
  const caps = useClientsCapabilities();
  const objectsOn = useFeatureOn("objects");
  // У КАЖДОЙ КОМАНДЫ СВОИ НАСТРОЙКИ КЛИЕНТОВ (владелец 30.09), как у
  // настроек календаря: лента команд наверху, строки «Для команды» правят
  // выбранную. Открывается на команде, выбранной в ленте списка, иначе —
  // на первой. Справочники, данные и функции — общие на компанию, ниже.
  const { data: ownTeams = [] } = useTeams();
  const { data: listTeam } = useClientsTeam(ownTeams[0]?.tenant_id ?? null);
  const setListTeam = useSetClientsTeam(ownTeams[0]?.tenant_id ?? null);
  const [pickedTeam, setPickedTeam] = useState<string | null>(null);
  const teamId =
    (pickedTeam && ownTeams.some((tm) => tm.id === pickedTeam) ? pickedTeam : null) ??
    (listTeam && listTeam !== ALL_TEAMS && ownTeams.some((tm) => tm.id === listTeam)
      ? listTeam
      : null) ??
    ownTeams[0]?.id ??
    null;
  const teamHref = (pathname: string): Href =>
    (teamId ? { pathname, params: { team: teamId } } : pathname) as Href;
  // Функции клиентов — у команды (владелец 30.09: «люди, связи, реквизиты,
  // файлы — всё закреплено за командой»).
  const peopleOn = useClientFunctionOn("client_people", teamId);
  const requisitesOn = useClientFunctionOn("client_requisites", teamId);
  const filesOn = useClientFunctionOn("client_files", teamId);
  const { data: prefs = DEFAULT_CARD_FIELDS } = useCardFields(teamId);
  // Подпись «Типов объектов» — настоящие типы команды, а не образец.
  const { data: teamObjectTypes = [] } = useLocationLabels(teamId);
  const objectTypeNames = teamObjectTypes.map((label) => label.name);
  // Подпись строки — что выключено у команды, иначе «Все блоки».
  const offBlocks = [
    !peopleOn ? "люди" : null,
    !filesOn ? "файлы" : null,
    !requisitesOn ? "реквизиты" : null,
  ].filter(Boolean);
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
    <Screen>
      <ScreenHeader
        title="Настройки клиентов"
        // Шов несёт лента команд; без неё линию берёт шапка (как в
        // настройках календаря).
        seam={!(caps.manage && ownTeams.length > 0)}
      />
      {caps.manage && ownTeams.length > 0 ? (
        <ScopeChips
          items={ownTeams.map((tm) => ({ id: tm.id, name: tm.name, color: tm.color }))}
          activeId={teamId}
          onSelect={setPickedTeam}
        />
      ) : null}
      {caps.manage ? (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 24 }}
        >
            <SectionEyebrow>Отображение</SectionEyebrow>
            <SectionCard>
              <SettingsRow
                tile={SETTINGS_TILE.blue}
                icon={Eye}
                // «КАРТОЧКА КЛИЕНТА», А НЕ «ЧТО ПОКАЗЫВАТЬ» (владелец 30.09:
                // «сделай то же самое, как в записи»): блоки страницы клиента
                // и строка списка — одна страница, как «Записи».
                title="Карточка клиента"
                sub={cardSub}
                onPress={() => router.push(teamHref("/clients/card-fields"))}
              />
              <Divider inset={56} />
              <SettingsRow
                tile={SETTINGS_TILE.green}
                icon={MessageCircle}
                title="Способы связи"
                // НАБОР ОДИН, И ПОДПИСЬ ОДНА (владелец 2026-09-04: «зачем „можно
                // добавить в карточку“ или „у номера“ — немного странно»). Раньше
                // строка складывала два списка — перечисление каналов и счётчик
                // полей — и читалась как каша из двух настроек.
                sub={enabledWays
                  .map((id) => contactWayDef(id)?.label)
                  .filter(Boolean)
                  .join(" · ")}
                onPress={() => router.push(teamHref("/clients/channels"))}
              />
  
              <Divider inset={56} />
              <SettingsRow
                tile={SETTINGS_TILE.blue}
                icon={Navigation}
                title="Карты для маршрута"
                sub={mapServicesSummary(mapServices)}
                onPress={() => router.push(teamHref("/clients/maps"))}
              />
            </SectionCard>

  
            {/* СПРАВОЧНИКИ — то, из чего собирается карточка: типы объектов
                («Вилла», «Дом»), метки, теги. Владелец 2026-08-02: «всё, что
                можно делать в клиентах, потом редактировать и исправлять».
                Экраны справочников общие с Кабинетом — заводить вторые не
                нужно, нужен вход отсюда, из места, где ими пользуются. */}
            {/* С 30.09 ВСЁ ЗДЕСЬ — У КОМАНДЫ, выбранной лентой: владелец —
                «типы объектов, теги, выгрузка, архив, корзина, люди, связи,
                реквизиты, файлы — всё закреплено за командой». */}
            <SectionEyebrow>Справочники</SectionEyebrow>
            <SectionCard>
              {/* Выключенные у компании объекты уносят и свой справочник. */}
              {objectsOn ? (
                <>
                  <SettingsRow
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
                  <Divider inset={56} />
                </>
              ) : null}
              <SettingsRow
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
                        : "Создать первый тег"
                }
                onPress={() => router.push(teamHref("/clients/tags"))}
              />
            </SectionCard>
            <SectionEyebrow>Данные</SectionEyebrow>
            <SectionCard>
              {/* Контакты телефона — первый способ, а не второй: у малого
                  сервиса база лежит именно там, а CSV требует сначала где-то
                  собрать таблицу, то есть не сделать никогда. В сборке без
                  нативного модуля строки нет вовсе. */}
              {CONTACTS_AVAILABLE ? (
                <>
                  <SettingsRow
                    tile={SETTINGS_TILE.blue}
                    icon={Smartphone}
                    title="Из контактов телефона"
                    sub="Выбрать, кого добавить"
                    onPress={() => backToList("openContacts")}
                  />
                  <Divider inset={56} />
                </>
              ) : null}
              <SettingsRow
                tile={SETTINGS_TILE.blue}
                icon={Upload}
                title="Импорт из CSV"
                sub="Загрузить клиентов из файла"
                onPress={() => backToList("openImport")}
              />
              <Divider inset={56} />
              <SettingsRow
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
              />
              <Divider inset={56} />
              <SettingsRow
                tile="neutral"
                icon={Archive}
                title="Архив клиентов"
                sub="Убраны из работы, история цела"
                onPress={() => router.push(teamHref("/clients/archive"))}
              />
              <Divider inset={56} />
              {/* Две полки рядом и подписаны по-разному: архив — без срока,
                  корзина — со счётчиком. Иначе «куда он делся» повторится, уже
                  с двумя одинаковыми на вид дверями. */}
              <SettingsRow
                tile={SETTINGS_TILE.red}
                icon={Trash2}
                title="Недавно удалённые"
                sub={`Хранятся ${TRASH_DAYS} дней, потом стираются`}
                onPress={() => router.push(teamHref("/clients/trash"))}
              />
            </SectionCard>
  

        </ScrollView>
      ) : (
        // Строк не открыли ни одной: страница остаётся собой, а тело
        // говорит одной строкой — без подписи и без кнопки (канон пустых
        // состояний, LOCKED 2026-08-27).
        <EmptyState fill title="Настроек пока нет" />
      )}

    </Screen>
  );
}
