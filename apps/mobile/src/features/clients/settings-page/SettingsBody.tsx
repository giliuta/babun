import { useMemo } from "react";
import { ScrollView } from "react-native";
import { useRouter, type Href } from "expo-router";
import {
  Download,
  Eye,
  Megaphone,
  MessageCircle,
  Navigation,
  Shapes,
  Smartphone,
  Tags,
  Trash2,
  Upload,
} from "lucide-react-native";
import { TRASH_DAYS } from "@babun/shared/db/repositories/clients";
import { buildStatsMap } from "@babun/shared/local/selectors/client-stats";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { CONTACTS_AVAILABLE } from "@/features/clients/import/ContactsImportSheet";
import {
  contactWayDef,
  isWayOffered,
  useEnabledWays,
} from "@/features/clients/contact-ways";
import {
  mapServicesSummary,
  useEnabledMapServices,
} from "@/features/clients/map-services";
import { shareClientsCsv } from "@/features/clients/bulk-export";
import { useClients, useClientTags } from "@/features/clients/queries";
import { useClientSources } from "@/features/clients/acquisition-sources";
import { sourcesSummary, teamSources } from "@/features/clients/acquisition-source";
import { useAppointments } from "@/features/calendar/queries";
import { useClientsCapabilities } from "@/session/company-scope";
import { useTeams } from "@/features/reference/queries";
import { useSetClientsTeam } from "@/features/clients/team-pref";
import { clientsOfTeam } from "@/features/clients/team-scope";
import { useFeatureOn } from "@/features/settings/company-features";
import { useLocationLabels } from "@/features/settings/local-settings";
import {
  useClientFunctionOn,
  type ClientFunctionKey,
} from "@/features/clients/client-functions";
import {
  blocksSummary,
  objectTypesSummary,
  tagsSummary,
} from "@/features/clients/settings-summary";
import { anyClientSetting } from "@/features/clients/settings-levels";
import { useClientSettingLevelsOf } from "@/features/clients/use-client-settings";
import { SettingsGroup } from "./SettingsGroup";

// «НАСТРОЙКИ КЛИЕНТОВ» — шестерёнка списка клиентов. С 02.10 разложены ПО
// ФУНКЦИЯМ КАРТОЧКИ (владелец: «чтоб оно разделялось всё по функциям»):
//   • Клиент — строка в списке, связь, заметка, личное;
//   • Объекты — типы объектов и карты для маршрута (03.10 без своей страницы);
//   • Карточка — метка и тег, люди, файлы, реквизиты;
//   • Данные — импорт, выгрузка, архив и корзина (только своей базы).
// Сортировка ЗДЕСЬ НЕ живёт: она первая строка листа «Фильтры» (решение
// владельца 2026-07-25).

// Подпись «Блоков клиентов» называет выключенные блоки словами их страницы.
const BLOCK_WORDS: [ClientFunctionKey, string][] = [
  ["client_note", "заметка"],
  ["client_people", "люди"],
  ["client_objects", "объекты"],
  ["client_files", "файлы"],
  ["client_requisites", "реквизиты"],
  ["client_labels", "метка"],
  ["client_tags", "тег"],
  ["client_personal", "личное"],
];

export function SettingsBody({ teamId, tenantParam }: { teamId: string; tenantParam: string | null }) {
  const router = useRouter();
  const toast = useToast();
  // ХОЗЯЙСТВО БАЗЫ («Данные») — только своей компании (владелец 20.09).
  const caps = useClientsCapabilities();
  const objectsOn = useFeatureOn("objects");
  // Выключено у всей компании (STORY-088) — в подписи блока не числится.
  const companyPeople = useFeatureOn("client_people");
  const companyFiles = useFeatureOn("client_files");
  const companyRequisites = useFeatureOn("client_requisites");
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
    client_tags: useClientFunctionOn("client_tags", teamId),
    client_personal: useClientFunctionOn("client_personal", teamId),
  };
  // «БЛОКИ КЛИЕНТОВ» — ОДНОЙ СТРОКОЙ (владелец 03.10: «всё в одну страницу и
  // там уже редактировать»): тумблеры блоков уехали на эту страницу, здесь —
  // что выключено. Строка — по праву «Карточки клиента».
  const showCard = levels.card !== "hidden";
  const offBlocks = BLOCK_WORDS.filter(
    ([key]) =>
      !blockOn[key] &&
      (key !== "client_objects" || objectsOn) &&
      (key !== "client_people" || companyPeople) &&
      (key !== "client_files" || companyFiles) &&
      (key !== "client_requisites" || companyRequisites),
  ).map(([, word]) => word);
  const { data: teamObjectTypes = [] } = useLocationLabels(teamId);
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
  // Источники команды (03.10) — счётчик строки «Источники».
  const sourcesQuery = useClientSources();
  const teamSourceCount = useMemo(
    () => teamSources(sourcesQuery.data ?? [], teamId).length,
    [sourcesQuery.data, teamId],
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
  // Чем связываются с клиентом. Звонок в настройке не стоит (владелец
  // 04.09: «идёт как стандарт») — и в подписи его нет.
  const enabledWays = useEnabledWays(teamId);
  const waysSub = enabledWays
    .filter((id) => isWayOffered(id))
    .map((id) => contactWayDef(id))
    .filter((def) => def && def.optional !== false)
    .map((def) => def?.label)
    .join(" · ");

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

  // «ОБЪЕКТЫ» — ПОДЗАГОЛОВОК С ДВУМЯ ДВЕРЯМИ (владелец 03.10: «полноценный
  // подзаголовок объекты, туда типы объектов и карты для маршрута, отдельную
  // страницу не надо»). Выключенные у компании объекты уносят типы; карты
  // тогда — отдельной строкой у клиента (маршрут по адресу клиента остаётся).
  const typesRow = objectsOn && levels.objects !== "hidden";
  const mapsRowAlone = !objectsOn && levels.maps !== "hidden";
  const mapsInObjects = objectsOn && levels.maps !== "hidden";

  return (
    <>
      {anyClientSetting(levels) ? (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 24 }}
        >
          {/* НАСТРОЙКИ ПО ФУНКЦИЯМ КАРТОЧКИ (владелец 02.10: «чтоб оно
              разделялось всё по функциям»). Каждая функция клиента — своя
              строка: два положения — тумблером, больше — дверью на свою
              страницу. Строка — по её праву в этой команде (01.10):
              «Скрыты» — строки нет, «Только видит» — без правки. */}
          <SettingsGroup
            title="Клиент"
            rows={[
              showCard ? (
                <SettingsRow
                  key="blocks"
                  tile={SETTINGS_TILE.blue}
                  icon={Eye}
                  title="Блоки клиентов"
                  sub={blocksSummary(offBlocks)}
                  onPress={() => router.push(teamHref("/clients/card-fields"))}
                />
              ) : null,
              levels.ways !== "hidden" ? (
                <SettingsRow
                  key="ways"
                  tile={SETTINGS_TILE.green}
                  icon={MessageCircle}
                  title="Связь"
                  sub={waysSub || "Только звонок"}
                  onPress={() => router.push(teamHref("/clients/channels"))}
                />
              ) : null,
              mapsRowAlone ? (
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

          {typesRow || mapsInObjects ? (
            <SettingsGroup
              title="Объекты"
              rows={[
                typesRow ? (
                  <SettingsRow
                    key="types"
                    tile={SETTINGS_TILE.teal}
                    icon={Shapes}
                    title="Типы объектов"
                    sub={objectTypesSummary(teamObjectTypes.map((label) => label.name))}
                    onPress={() => router.push(teamHref("/clients/object-types"))}
                  />
                ) : null,
                mapsInObjects ? (
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
          ) : null}

          {/* ТЕГИ И ИСТОЧНИКИ — СПРАВОЧНИКИ КОМАНДЫ: какие есть. Включён ли
              блок «Тег» на карточке — на странице «Блоки клиентов». Источники
              (03.10) — справочник команды с засеянными готовыми, со своим
              правом «Источники» (как у каждой строки шестерёнки). */}
          <SettingsGroup
            title="Справочники"
            rows={[
              // Строка — своим правом «Теги» (аудит 03.10: по «Блокам
              // клиентов» она открывалась пустой страницей).
              levels.tags !== "hidden" ? (
                <SettingsRow
                  key="tags"
                  tile={SETTINGS_TILE.purple}
                  icon={Tags}
                  title="Теги"
                  sub={tagsQuery.isLoading ? "Загрузка…" : tagsSummary(teamTags.length)}
                  onPress={() => router.push(teamHref("/clients/tags"))}
                />
              ) : null,
              levels.sources !== "hidden" ? (
                <SettingsRow
                  key="sources"
                  tile={SETTINGS_TILE.orange}
                  icon={Megaphone}
                  title="Источники"
                  sub={sourcesQuery.isLoading ? "Загрузка…" : sourcesSummary(teamSourceCount)}
                  onPress={() => router.push(teamHref("/clients/sources"))}
                />
              ) : null,
            ]}
          />

          {/* ДАННЫЕ — ХОЗЯЙСТВО СВОЕЙ БАЗЫ: импорт, выгрузка и удалённые.
              Партнёру их нет (выгрузка — «без передачи», 30.09). */}
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
                // ОДНА ПОЛКА (владелец 03.10: «понятия „в архив" не будет —
                // удалить»). Без записей и денег клиент стирается через
                // срок; с историей — лежит здесь, пока его не вернут.
                <SettingsRow
                  key="trash"
                  tile={SETTINGS_TILE.red}
                  icon={Trash2}
                  title="Удалённые клиенты"
                  sub={`Без истории стираются через ${TRASH_DAYS} дней`}
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
    </>
  );
}
