import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Search,
  Settings,
  SlidersHorizontal,
  Users,
} from "lucide-react-native";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import type { Client } from "@babun/shared/local/clients";
import { buildStatsMap } from "@babun/shared/local/selectors/client-stats";
import {
  clientMemberOf,
  clientsById,
  linkLine,
} from "@babun/shared/local/selectors/client-links";
import { countWordRu } from "@babun/shared/common/utils/pluralize";
import { EmptyState } from "@/components/ui/EmptyState";
import { ScopeChips } from "@/components/ui/ScopeChips";
import { LoadingBar } from "@/components/ui/LoadingBar";
import { Spinner } from "@/components/ui/Spinner";
import { GradientButton } from "@/components/ui/GradientButton";
import { Screen } from "@/components/ui/Screen";
import { useToast } from "@/components/ui/Toast";
import { usePullRefresh } from "@/lib/pull-refresh";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import {
  useClients,
  useClientTags,
  useUpdateClientById,
} from "@/features/clients/queries";
import { useArchiveWithUndo } from "@/features/clients/archive-undo";
import { TRASH_DAYS } from "@babun/shared/db/repositories/clients";
import ClientRow from "@/features/clients/ClientRow";
import {
  EMPTY_FILTER,
  segmentEvidence,
  type ClientsFilter,
} from "@/features/clients/filter";
import { useClientFilters } from "@/features/clients/useClientFilters";
import {
  ALL_TEAMS,
  appointmentsOfTeam,
  clientsOfTeam,
  liveTeamChoice,
  rowTeamLabelId,
  teamForNewClient,
  toggleTeamChoice,
} from "@/features/clients/team-scope";
import { useClientsTeam, useSetClientsTeam } from "@/features/clients/team-pref";
import { ClientsCompanyRoute } from "@/features/clients/ClientsCompanyRoute";
import {
  useClientsCapabilities,
  useClientsScopeOrNull,
} from "@/features/clients/company-scope";
import { useClientsSources } from "@/features/clients/sources";
import { useGuestSources } from "@/features/clients/guest-sources";
import {
  clientCardHref,
  clientsInsightsHref,
  clientsSettingsHref,
  type ClientsScope,
} from "@/features/clients/clients-company";
import {
  loadDayFilter,
  saveDayFilter,
} from "@/features/clients/filter-pref";
import {
  useClientsSort,
  useSetClientsSort,
} from "@/features/clients/sort-pref";
import {
  useCardFieldsByTeam,
  type CardFieldPrefs,
} from "@/features/clients/card-prefs";
import { ClientActionsSheet } from "@/features/clients/ClientActionsSheet";
import { useGuardedBookingNav } from "@/features/clients/card-booking";
import { RemindSheet } from "@/features/clients/RemindSheet";
import { ClientDataNotice } from "@/features/clients/ClientDataNotice";
import { ClientsFilterSheet } from "@/features/clients/ClientsFilterSheet";
import { ImportWizardSheet } from "@/features/clients/import/ImportWizardSheet";
import { ContactsImportSheet } from "@/features/clients/import/ContactsImportSheet";
import { BulkActionBar } from "@/features/clients/BulkActionBar";
import { BulkSmsSheet } from "@/features/clients/BulkSmsSheet";
import { shareClientsCsv } from "@/features/clients/bulk-export";
import { useAppointments } from "@/features/calendar/queries";
import { useCities, useTeams } from "@/features/reference/queries";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";

// v811 list card (approved web design, apps/web/.../clients/page.tsx
// ClientCard): name row (+pin) · money row (grey expected · green income
// · gold debt) · meta row (посл. запись · команда · город · теги).
// Field visibility is driven by the «Что показывать» prefs (cardFields).
//
// Bulk-mode (web-parity): long-press ENTERS selection mode; in it the avatar
// becomes a checkbox, the contact button hides, and a tap toggles the pick
// instead of opening the card.
//
// СВАЙПЫ (2026-08-06): вправо — «Записать», влево — «Напомнить» и «В архив».
// Телефон для них не нужен; в режиме выбора свайпы отключены целиком.

// ОБЩАЯ СТРАНИЦА (STORY-082): ворота говорят, чья это компания, экран
// склеивает её список с клиентами компаний, где человеку их открыли.
export default function ClientsListRoute() {
  return (
    <ClientsCompanyRoute kind="tab">
      <ClientsListScreen />
    </ClientsCompanyRoute>
  );
}

/** Склейка без дублей: первая строка с этим id побеждает (своя компания
 *  идёт первой). */
function uniqueById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

function ClientsListScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const toast = useToast();
  // Экран настроек возвращается сюда с nonce-параметром:
  // «Импорт из CSV» → openImport.
  const params = useLocalSearchParams<{
    openImport?: string;
    /** «Из контактов телефона» → openContacts. */
    openContacts?: string;
  }>();
  const scope = useClientsScopeOrNull();
  const caps = useClientsCapabilities();
  const sources = useClientsSources();
  // Гости — компании, где человеку открыли клиентов; своя читается обычными
  // хуками вкладки (у них источник из контекста).
  const guestScopes = useMemo(
    () => sources.list.filter((source) => source.tenantId !== scope?.tenantId),
    [sources.list, scope?.tenantId],
  );
  const guests = useGuestSources(guestScopes);
  const { data, isLoading, isRefetching, refetch, error } = useClients();
  // Контрол обновления отражает ЖЕСТ, а не любое дообновление: иначе список
  // сам уезжал вниз с застывшей системной вертушкой.
  const refreshAll = useCallback(
    () => Promise.all([refetch(), guests.refetch()]),
    [refetch, guests],
  );
  const pull = usePullRefresh(refreshAll);
  const { data: ownTags = [] } = useClientTags();
  const { data: ownAppointments = [] } = useAppointments();
  const { data: ownTeams = [] } = useTeams();
  const { data: cities = [] } = useCities();
  // Сортировка — персистентная настройка списка (первая строка листа
  // «Фильтры»), не фильтр: «Сбросить» её не трогает.
  const { data: sort = "recent" } = useClientsSort();
  const setSort = useSetClientsSort();
  const archiveWithUndo = useArchiveWithUndo();
  const updateById = useUpdateClientById();
  const [query, setQuery] = useState("");
  // Набор живёт до конца дня: звонок/SMS выбрасывают из приложения, и
  // собирать шесть условий заново каждый круг обзвона — потеря времени.
  const [filter, setFilter] = useState<ClientsFilter>(
    () => loadDayFilter() ?? EMPTY_FILTER,
  );
  useEffect(() => {
    saveDayFilter(filter);
  }, [filter]);
  const [sheetOpen, setSheetOpen] = useState(false);
  // С какого измерения открыть лист (тап по телу токена в баре).
  const [initialFacet, setInitialFacet] = useState<
    "segment" | "city" | "tag" | "team" | "source" | "property" | null
  >(null);
  const [importOpen, setImportOpen] = useState(false);
  const [contactsOpen, setContactsOpen] = useState(false);

  // ── Bulk-mode (multi-select) ──────────────────────────────────────
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [smsOpen, setSmsOpen] = useState(false);

  useEffect(() => {
    if (params.openContacts) setContactsOpen(true);
    if (params.openImport) setImportOpen(true);
  }, [params.openImport, params.openContacts]);

  // ОДИН СПИСОК ИЗ НЕСКОЛЬКИХ КОМПАНИЙ. Строка знает свою компанию: по ней
  // открывается карточка и по ней решается, что со строкой можно.
  const clients = useMemo(
    () => uniqueById([...(data ?? []), ...guests.list.flatMap((guest) => guest.clients)]),
    [data, guests.list],
  );
  // Карта карточек для строки связи «жилец · Наталья · Вилла 5» — одна на
  // список, а не по строке: строк сотни, и каждая спрашивает её заново.
  const byId = useMemo(() => clientsById(clients), [clients]);
  const guestOf = useMemo(() => {
    const byClient = new Map<string, ClientsScope>();
    for (const guest of guests.list) {
      for (const client of guest.clients) byClient.set(client.id, guest.scope);
    }
    return byClient;
  }, [guests.list]);
  const appointments = useMemo(
    () => uniqueById([...ownAppointments, ...guests.list.flatMap((guest) => guest.appointments)]),
    [ownAppointments, guests.list],
  );
  // Склейка справочников идёт ПО ИДЕНТИФИКАТОРУ: одна и та же компания может
  // прийти и своим хуком, и гостевым источником (её календарь открыт), а два
  // одинаковых ключа в списке — это и предупреждение React, и две одинаковые
  // строки в фильтре.
  const teams = useMemo(
    () => uniqueById([...ownTeams, ...guests.list.flatMap((guest) => guest.teams)]),
    [ownTeams, guests.list],
  );
  const tags = useMemo(
    () => uniqueById([...ownTags, ...guests.list.flatMap((guest) => guest.tags)]),
    [ownTags, guests.list],
  );
  // ЛЕНТА КОМАНД (владелец 30.09). Клиент принадлежит команде полем карточки
  // (`team_id`), а не последним визитом. Чипа «Все» нет: ни одна команда не
  // нажата — видны все; тап включает команду, повторный тап снимает. Выбор
  // помнится по компании; исчезнувшая команда снимается сама.
  const { data: savedTeam } = useClientsTeam(scope?.tenantId ?? null);
  const setSavedTeam = useSetClientsTeam(scope?.tenantId ?? null);
  const teamChoice = liveTeamChoice(
    savedTeam,
    teams.map((tm) => tm.id),
  );
  // Команды компаний-партнёров — обводкой: тот же язык, что у ленты
  // календаря (чужой чип уводит в чужую базу, а не режет свою).
  const teamChips = useMemo(() => {
    const own = new Set(ownTeams.map((tm) => tm.id));
    return teams.map((tm) => ({
      id: tm.id,
      name: tm.name,
      color: tm.color,
      outline: !own.has(tm.id),
    }));
  }, [teams, ownTeams]);
  // КЛИЕНТ ОДИН НА НЕСКОЛЬКО КОМАНД (см. `team-scope.ts`): под чипом — свои
  // клиенты команды и те, кого она обслуживала; цифры — по её записям.
  const teamClients = useMemo(
    () => clientsOfTeam(clients, teamChoice, appointments),
    [clients, teamChoice, appointments],
  );
  const teamAppointments = useMemo(
    () => appointmentsOfTeam(appointments, teamChoice),
    [appointments, teamChoice],
  );
  // Деньги чужой компании сотруднику не приходят вовсе — в строке их нет.
  // «ЧТО ПОКАЗЫВАТЬ НА КАРТОЧКЕ» — У КОМАНДЫ (владелец 30.09): строка
  // клиента берёт набор СВОЕЙ команды клиента, пока та ничего не меняла —
  // общий набор.
  const teamIdList = useMemo(() => teams.map((tm) => tm.id), [teams]);
  const cardFieldsFor = useCardFieldsByTeam(teamIdList);
  const guestCardFields = useCallback(
    (fields: CardFieldPrefs): CardFieldPrefs => ({
      ...fields,
      exp: false,
      inc: false,
      debt: false,
    }),
    [],
  );

  // Per-client roll-up (visits / money / debt / last team) — one pass
  // over appointments, shared by the cards, the sort and the filter.
  // Под чипом команды строка, сортировка и фильтры считают ТОЛЬКО её записи.
  // Полная история нужна там, где решается судьба клиента: можно ли его
  // удалить и что уйдёт в выгрузку, — там `allStatsMap`.
  const allStatsMap = useMemo(
    () => buildStatsMap(clients, appointments),
    [clients, appointments],
  );
  const teamStatsMap = useMemo(
    () =>
      teamChoice === ALL_TEAMS ? null : buildStatsMap(teamClients, teamAppointments),
    [teamChoice, teamClients, teamAppointments],
  );
  const statsMap = teamStatsMap ?? allStatsMap;

  // Первая и последняя (не отменённые) записи — сплит периода в фильтрах
  // показывает у «Всего времени» честный охват данных в обе стороны.
  const dataSpan = useMemo(() => {
    let min: string | null = null;
    let max: string | null = null;
    for (const a of teamAppointments) {
      if (a.status === "cancelled" || !a.date) continue;
      if (!min || a.date < min) min = a.date;
      if (!max || a.date > max) max = a.date;
    }
    return { from: min, to: max };
  }, [teamAppointments]);

  // ТЕГИ В ФИЛЬТРАХ — КОМАНДЫ (владелец 30.09: «теги закреплены за
  // командой»): под чипом — её теги; без чипа — все, и одинаковые имена
  // разных команд подписаны командой, иначе две «VIP» не различить.
  const filterTags = useMemo(() => {
    if (teamChoice !== ALL_TEAMS) {
      return tags.filter((tag) => !tag.team_id || tag.team_id === teamChoice);
    }
    const byName = new Map<string, number>();
    for (const tag of tags) {
      const key = tag.name.trim().toLowerCase();
      byName.set(key, (byName.get(key) ?? 0) + 1);
    }
    return tags.map((tag) => {
      const shared = (byName.get(tag.name.trim().toLowerCase()) ?? 0) > 1;
      const teamName = tag.team_id ? teams.find((tm) => tm.id === tag.team_id)?.name : null;
      return shared && teamName ? { ...tag, name: `${tag.name} · ${teamName}` } : tag;
    });
  }, [tags, teams, teamChoice]);

  // Web useClientFilters port. Внутри сортировка живёт в отдельном мемо
  // (deps без поиска) — фикс Волны 1 сохранён: клавиши не гоняют
  // localeCompare-компаратор.
  const result = useClientFilters(
    teamClients,
    teamAppointments,
    teams,
    cities,
    filterTags,
    statsMap,
    sort,
    filter,
    query,
    sheetOpen, // счётчики попапов считаем только при открытом листе
  );

  // Прунинг «призрачных» фильтров: если тег/команду/метку удалили, пока
  // фильтр по ним активен, список схлопнулся бы в ноль без токена для
  // снятия. Держим выбранное подмножеством живых опций.
  const { teamOptions, cityOptions, tagOptions } = result;
  useEffect(() => {
    setFilter((f) => {
      const teamSet = new Set(teamOptions.map((o) => o.value));
      const tagSet = new Set(tagOptions.map((o) => o.value));
      const citySet = new Set(cityOptions.map((o) => o.value));
      // Строки «Команда» в фильтрах с 30.09 нет — команду выбирает лента.
      // Забытый вчерашний выбор прятал бы клиентов без видимого токена.
      void teamSet;
      const selectedTeams: string[] = [];
      const activeTags = f.activeTags.filter((x) => tagSet.has(x));
      const selectedCities = f.selectedCities.filter((x) => citySet.has(x));
      if (
        selectedTeams.length === f.selectedTeams.length &&
        activeTags.length === f.activeTags.length &&
        selectedCities.length === f.selectedCities.length
      )
        return f;
      return { ...f, selectedTeams, activeTags, selectedCities };
    });
  }, [teamOptions, cityOptions, tagOptions]);

  const filtering = result.activeCount > 0 || query.trim().length > 0;

  // ── Long-press меню клиента (web v313 parity) — нижний лист
  // ClientActionsSheet; здесь только состояние и обработчики.
  const [menuClient, setMenuClient] = useState<Client | null>(null);

  // Напоминание — ТОТ ЖЕ лист, что на карточке: одно действие не может
  // выглядеть по-разному в двух местах (раньше здесь был системный Alert).
  const [remindClient, setRemindClient] = useState<Client | null>(null);
  const openRemindMenu = (c: Client) => setRemindClient(c);

  // ЗАПИСАТЬ ПРЯМО ИЗ СПИСКА (свайп вправо и лист действий). Строка уже знает
  // и основной объект, и последнюю команду — те же два поля, что подставляет
  // карточка, поэтому лишний заход в карточку ради «Записать» больше не
  // нужен. Чёрный список спрашивает через тот же общий гейт.
  // Ссылка на открытую свайпом строку — чтобы закрыть её, когда открывают
  // соседнюю.
  const openSwipe = useRef<SwipeableMethods | null>(null);
  const guardedBook = useGuardedBookingNav();
  const bookFor = (c: Client) => {
    const primary =
      (c.locations ?? []).find((l) => l.isPrimary)?.id ??
      (c.locations ?? [])[0]?.id ??
      null;
    guardedBook(c, {
      locationId: primary,
      // Под чипом — в выбранную команду (её список и открыт); без чипа — в
      // команду клиента, у клиента без неё — в команду последнего визита.
      teamId:
        teamChoice !== ALL_TEAMS
          ? teamChoice
          : (c.team_id ?? allStatsMap.get(c.id)?.lastTeamId ?? null),
    });
  };

  const confirmArchiveOne = (c: Client) => {
    confirmThen(
      "Архивировать клиента?",
      {
        message: `${c.full_name || "Клиент"} исчезнет из рабочего списка. Вся история сохранится; вернуть можно сразу кнопкой «Отменить», а позже — в шестерёнке, «Архив клиентов».`,
        confirmLabel: "Архивировать",
        destructive: true,
      },
      async () => {
        try {
          await archiveWithUndo([c]);
        } catch (e) {
          notify("Не удалось архивировать", (e as Error).message);
        }
      },
    );
  };

  // УДАЛИТЬ ≠ АРХИВ: клиент едет в «Недавно удалённые» и через 30 дней
  // стирается сам. За клиентом с визитами стоит финансовая история — база
  // стереть его не даст, поэтому говорим это ДО действия и предлагаем архив.
  const confirmDeleteOne = (c: Client) => {
    const stats = allStatsMap.get(c.id);
    // ЛЮБАЯ запись — уже история, даже будущая. База запрещает стирать
    // клиента с заявками (guard_client_hard_delete_history), поэтому такой
    // клиент лёг бы в корзину НАВСЕГДА: счётчик тикает, а ночная очистка
    // его пропускает — он застревает между полками.
    const hasHistory =
      (stats?.visits ?? 0) > 0 ||
      (stats?.totalSpent ?? 0) > 0 ||
      (stats?.unclosedVisits ?? 0) > 0 ||
      stats?.nextApt != null;
    if (hasHistory) {
      confirmThen(
        "Этого клиента нельзя удалить",
        {
          message: "За этим клиентом есть визиты и деньги — они останутся в отчётах и должны быть к кому-то привязаны. Такого клиента убирают в архив: из списка он исчезнет, история сохранится.",
          confirmLabel: "В архив",
        },
        () => confirmArchiveOne(c),
      );
      return;
    }
    confirmThen(
      "Удалить клиента?",
      {
        message: `${c.full_name || "Клиент"} переедет в «Недавно удалённые» и будет стёрт через ${TRASH_DAYS} дней. До этого его можно вернуть — в шестерёнке.`,
        confirmLabel: "Удалить",
        destructive: true,
      },
      async () => {
        try {
          await archiveWithUndo([c], true);
        } catch (e) {
          notify("Не удалось удалить", (e as Error).message);
        }
      },
    );
  };

  const onTogglePin = (c: Client) =>
    updateById.mutate({
      id: c.id,
      patch: { pinned_at: c.pinned_at ? null : new Date().toISOString() },
    });

  // ── Bulk-mode helpers ─────────────────────────────────────────────
  const visible = result.filtered; // «Выбрать всё» = всё, что сейчас в списке
  // Считаем ВИДИМЫХ выбранных: массовое действие работает по ним же,
  // а selectedIds может помнить исчезнувших из выдачи.
  const pickedCount = visible.reduce(
    (n, c) => (selectedIds.has(c.id) ? n + 1 : n),
    0,
  );
  const allSelected =
    visible.length > 0 && visible.every((c) => selectedIds.has(c.id));

  const enterSelection = (seedId?: string) => {
    setSelecting(true);
    setSelectedIds(seedId ? new Set([seedId]) : new Set());
  };
  const exitSelection = () => {
    setSelecting(false);
    setSelectedIds(new Set());
  };
  const toggleId = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelectedIds(allSelected ? new Set() : new Set(visible.map((c) => c.id)));

  // Массовые действия — строго по ВИДИМОМУ списку: если фильтр изменился
  // после выбора, «Архивировать 12» не должно задеть невидимых.
  const selectedClients = useMemo(
    () => result.filtered.filter((c) => selectedIds.has(c.id)),
    [result.filtered, selectedIds],
  );

  const onExport = async () => {
    if (selectedClients.length === 0) return;
    try {
      const shared = await shareClientsCsv(selectedClients, tags, allStatsMap);
      if (shared) {
        toast(`CSV выгружен (${selectedClients.length})`, "success");
        exitSelection();
      }
    } catch (e) {
      notify("Не удалось выгрузить", (e as Error).message);
    }
  };

  const onArchive = () => {
    const n = selectedClients.length;
    if (n === 0) return;
    const word = countWordRu(n, "клиента", "клиента", "клиентов");
    confirmThen(
      `Архивировать ${n} ${word}?`,
      {
        message: "Клиенты исчезнут из рабочего списка. Заявки, инвойсы и финансовая история сохранятся; вернуть можно сразу кнопкой «Отменить», а позже — в шестерёнке, «Архив клиентов».",
        confirmLabel: "Архивировать",
        destructive: true,
      },
      async () => {
        try {
          // Итог (в т.ч. частичный) и кнопка отмены — в одном тосте;
          // здесь остаётся только случай «не уехал никто».
          const { archived, failed } =
            await archiveWithUndo(selectedClients);
          if (archived === 0) {
            notify(
              "Не удалось архивировать",
              `Ни один из ${failed} клиентов не архивирован. Проверьте соединение и попробуйте ещё раз.`,
            );
            return;
          }
          exitSelection();
        } catch (e) {
          notify("Не удалось архивировать", (e as Error).message);
        }
      },
    );
  };

  return (
    // edges top-only: экран внутри Tabs — нижний safe-area держит таб-бар,
    // иначе двойной инсет (~34pt зазор над CTA). Паттерн chats/(dashboard).
    <Screen edges={["top"]}>
      {selecting ? (
        // Селекшн-хедер: Отмена · «Выбрано N» · Выбрать всё/Снять.
        <View className="flex-row items-center justify-between px-4 pb-2 pt-4">
          <Pressable
            onPress={exitSelection}
            accessibilityRole="button"
            accessibilityLabel="Отменить выбор"
            className="min-h-11 justify-center px-1 active:opacity-60"
          >
            <Text
              className="text-base font-semibold"
              style={{ color: t.accent }}
            >
              Отмена
            </Text>
          </Pressable>
          <Text className="text-base font-semibold" style={{ color: t.ink }}>
            {pickedCount > 0
              ? `Выбрано ${pickedCount}`
              : "Выберите клиентов"}
          </Text>
          <Pressable
            onPress={toggleAll}
            accessibilityRole="button"
            accessibilityLabel={allSelected ? "Снять всё" : "Выбрать всё"}
            className="min-h-11 justify-center px-1 active:opacity-60"
          >
            <Text
              className="text-base font-semibold"
              style={{ color: t.accent }}
            >
              {allSelected ? "Снять" : "Всё"}
            </Text>
          </Pressable>
        </View>
      ) : (
        // Шапка в анатомии CalendarHeader (правило единого стиля): полоса
        // на surface с нижним разделителем, шестерёнка СЛЕВА (44×44,
        // t.sub 21/2), по центру — поиск (заголовок-дубль «Клиенты»
        // убран: имя вкладки уже в таб-баре), справа — аналитика и «+».
        // Вход в мультивыбор переехал в long-press меню строки (web v313).
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            paddingHorizontal: 8,
            minHeight: 48,
            backgroundColor: t.surface,
            // Шов снизу даёт лента команд (как в календаре): две линии
            // подряд читались бы как случайный зазор.
            borderBottomWidth: teams.length > 0 ? 0 : 1,
            borderBottomColor: t.separator,
          }}
        >
          <Pressable
            onPress={() => router.push(clientsSettingsHref())}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Настройки клиентов"
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: t.radius.card,
              backgroundColor: pressed ? t.pressed : "transparent",
            })}
          >
            <Settings color={t.sub} size={21} strokeWidth={2} />
          </Pressable>

          <View
            className="h-9 flex-1 flex-row items-center gap-1.5 px-2.5"
            style={{ borderRadius: t.radius.input, backgroundColor: t.fill }}
          >
            <Search color={t.faint} size={16} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              // Приём Jobber: активные фильтры меняют плейсхолдер — статус
              // «список отфильтрован» виден даже без открытия панели.
              placeholder={
                result.activeCount > 0
                  ? "Поиск среди отфильтрованных"
                  : "Имя, телефон, адрес"
              }
              accessibilityLabel="Поиск клиентов"
              placeholderTextColor={t.placeholder}
              selectionColor={t.accent}
              keyboardAppearance="light"
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              returnKeyType="search"
              clearButtonMode="while-editing"
              maxFontSizeMultiplier={1.3}
              // ПОЛЕ РАСТЯНУТО НА ВСЮ ВЫСОТУ ПЛАШКИ. Без этого iOS после
              // перерисовки ронял подсказку ниже плашки — «Имя, телефон,
              // адрес» обрезалась снизу (владелец 30.09: «поисковик съехал»).
              // Не числом: `h-9` плашки — это rem NativeWind, а не 36pt.
              style={{
                flex: 1,
                alignSelf: "stretch",
                paddingVertical: 0,
                fontSize: 15,
                textAlignVertical: "center",
                color: t.ink,
              }}
            />
          </View>

          {/* ФИЛЬТРЫ — ЗНАЧКОМ СПРАВА (владелец 30.09: «фильтры запихиваем
              в аналитику, правой вверху»). Строка «Фильтры · N клиентов» под
              поиском уступила место ленте команд; аналитика — последней
              строкой шторки. Включённый фильтр — точкой на значке: список
              не имеет права прятать клиентов молча. */}
          <Pressable
            onPress={() => {
              setInitialFacet(null);
              setSheetOpen(true);
            }}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={
              result.activeCount > 0
                ? `Фильтры, включено ${result.activeCount}`
                : "Фильтры"
            }
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: t.radius.card,
              backgroundColor: pressed ? t.pressed : "transparent",
            })}
          >
            <SlidersHorizontal
              color={result.activeCount > 0 ? t.accent : t.sub}
              size={21}
              strokeWidth={2}
            />
            {result.activeCount > 0 ? (
              <View
                style={{
                  position: "absolute",
                  top: 9,
                  right: 8,
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: t.accent,
                  borderWidth: 1.5,
                  borderColor: t.surface,
                }}
              />
            ) : null}
          </Pressable>
        </View>
      )}

      {/* ЛЕНТА КОМАНД — на месте строки фильтров. В режиме выбора её нет:
          фокус на наборе. Без команд (компания их не завела) ленты нет. */}
      {!selecting && teams.length > 0 ? (
        <ScopeChips
          items={teamChips}
          activeId={teamChoice === ALL_TEAMS ? null : teamChoice}
          onSelect={(id) => {
            haptics.tap();
            setSavedTeam.mutate(toggleTeamChoice(teamChoice, id));
          }}
        />
      ) : null}

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <Spinner size={30} label="Загрузка клиентов" />
        </View>
      ) : error ? (
        <ClientDataNotice
          fullScreen
          title="Не удалось загрузить клиентов"
          message={
            (error as Error).message ||
            "Проверьте соединение и повторите попытку."
          }
          onRetry={() => void refetch()}
          retrying={isRefetching}
        />
      ) : (
        <>
        {/* Дообновление в фоне: данные на экране уже есть, поэтому индикация
            не имеет права сдвигать список. */}
        <LoadingBar visible={isRefetching && !pull.refreshing} />
        <FlatList
          style={{ flex: 1 }}
          accessibilityLabel="Список клиентов"
          data={result.filtered}
          keyExtractor={(c) => c.id}
          keyboardShouldPersistTaps="handled"
          // Низ списка не должен прятаться под нижней панелью массовых
          // действий в режиме выбора; вне выбора — небольшой отступ.
          contentContainerStyle={{
            paddingBottom: selecting ? 108 : 24,
          }}
          renderItem={({ item }) => {
            const stats = statsMap.get(item.id);
            const rowTeamId = rowTeamLabelId(item, teamChoice, stats?.lastTeamId ?? null);
            const teamName = rowTeamId
              ? (teams.find((tm) => tm.id === rowTeamId)?.name ?? null)
              : null;
            // ГОСТЬ — клиент компании, где человек работает. Его карточка
            // открывается в ЕГО компании, а жесты своей базы (записать,
            // напомнить, архив) и массовый выбор к нему не относятся: это
            // хозяйство владельца той компании.
            const guest = guestOf.get(item.id);
            return (
              <ClientRow
                client={item}
                stats={stats}
                teamName={teamName}
                tags={tags}
                link={linkLine(clientMemberOf(item, byId))?.text}
                cardFields={
                  guest
                    ? guestCardFields(cardFieldsFor(item.team_id))
                    : cardFieldsFor(item.team_id)
                }
                selectionMode={selecting && !guest}
                picked={selectedIds.has(item.id)}
                onPress={() =>
                  guest
                    ? router.push(clientCardHref(item.id, guest.tenantId))
                    : selecting
                      ? toggleId(item.id)
                      : router.push(`/clients/${item.id}`)
                }
                evidence={segmentEvidence(item, filter.segments, stats)}
                onSwipeOpen={(row) => {
                  if (openSwipe.current && openSwipe.current !== row) {
                    openSwipe.current.close();
                  }
                  openSwipe.current = row;
                }}
                onBook={!guest && caps.book ? () => bookFor(item) : undefined}
                onRemind={!guest && caps.edit ? () => setRemindClient(item) : undefined}
                onArchive={!guest && caps.manage ? () => confirmArchiveOne(item) : undefined}
                onLongPress={() => {
                  if (guest) return;
                  if (selecting) toggleId(item.id);
                  else setMenuClient(item);
                }}
              />
            );
          }}
          ItemSeparatorComponent={() => (
            <View
              className="ml-[68px] h-px"
              style={{ backgroundColor: t.separator }}
            />
          )}
          refreshControl={
            // В режиме выбора pull-to-refresh отключаем — refetch мог бы
            // выронить выбранные строки из-под чекбоксов.
            selecting ? undefined : (
              <RefreshControl
                refreshing={pull.refreshing}
                onRefresh={pull.onRefresh}
                tintColor={t.accent}
              />
            )
          }
          ListEmptyComponent={
            filtering ? (
              <EmptyState
                title="Ничего не найдено"
                subtitle="Измените запрос или сбросьте фильтры"
              />
            ) : (
              <EmptyState
                icon={<Users color={t.faint} size={40} strokeWidth={1.5} />}
                title={
                  teamChoice === ALL_TEAMS
                    ? "Пока нет клиентов"
                    : "В этой команде пока нет клиентов"
                }
                // Подписи здесь нет: канон пустых состояний (LOCKED
                // 2026-08-27) оставляет объяснения ошибкам. Что делать
                // дальше, говорит футер — он на месте у всех.
              />
            )
          }
        />
        </>
      )}

      {/* В режиме выбора — нижняя панель массовых действий; вне выбора —
          полноценная кнопка создания внизу, вместо отдельной иконки в шапке.

          «СОЗДАТЬ КЛИЕНТА», А НЕ «ДОБАВИТЬ» (владелец 2026-09-10: «тут кнопка
          должна быть „создать клиента", как и в шторке»). Одно и то же
          действие звалось двумя словами: лист выбора клиента говорит
          «Создать клиента», чат говорит «Создать клиента», а вкладка говорила
          «Добавить». «Добавить …» в продукте значит «дописать строку в
          список» — счёт, услугу, номер; человека же заводят, и заводят его
          одной и той же дверью откуда угодно. */}
      {selecting ? (
        <BulkActionBar
          count={pickedCount}
          onSms={() => setSmsOpen(true)}
          onExport={onExport}
          onArchive={caps.manage ? onArchive : undefined}
        />
      ) : (
        // КНОПКА НА СВОЁМ МЕСТЕ И СЕРАЯ, как в «Финансах» (владелец 20.09:
        // «визуал целой страницы мы полностью сохраняем, а потом просто
        // отключаем, что будет работать, а что нет»). Исчезающий футер менял
        // рост страницы вместе с правами.
        <View
          style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 }}
        >
          <GradientButton
            label="Создать клиента"
            onPress={() => router.push("/clients/new")}
            disabled={!caps.create}
          />
        </View>
      )}

      <RemindSheet
        visible={remindClient !== null}
        clientName={remindClient?.full_name}
        hasReminder={!!remindClient?.reminder_at}
        onPick={(reminder_at) => {
          if (remindClient) {
            updateById.mutate({
              id: remindClient.id,
              patch: { reminder_at },
            });
          }
        }}
        onClose={() => setRemindClient(null)}
      />
      <ClientActionsSheet
        client={menuClient}
        // Те же права, что у свайпов строки: записать — «можно записать»,
        // напомнить — «меняет карточку», закрепить, архив и удаление —
        // владелец своей компании (сервер у сотрудника их отказывает).
        onBook={caps.book ? bookFor : undefined}
        onClose={() => setMenuClient(null)}
        // Выбор нескольких ведёт к экспорту и массовой SMS — только своя
        // база (владелец 30.09: «без передачи»).
        onSelectMany={caps.export ? (c) => enterSelection(c.id) : undefined}
        onTogglePin={caps.manage ? onTogglePin : undefined}
        onRemind={caps.edit ? openRemindMenu : undefined}
        onArchive={caps.manage ? confirmArchiveOne : undefined}
        onDelete={caps.manage ? confirmDeleteOne : undefined}
      />
      <ClientsFilterSheet
        visible={sheetOpen}
        filter={filter}
        result={result}
        dataFrom={dataSpan.from}
        dataTo={dataSpan.to}
        search={query}
        onClearSearch={setQuery}
        initialFacet={initialFacet}
        sort={sort}
        onSortChange={(s) => setSort.mutate(s)}
        onChange={setFilter}
        onClose={() => setSheetOpen(false)}
        hideTeam
        onAnalytics={
          scope
            ? () => {
                setSheetOpen(false);
                router.push(clientsInsightsHref(scope));
              }
            : undefined
        }
      />
      {/* Импорт — в выбранную команду (из «Все» — в первую): у каждой
          команды свой импорт (владелец 30.09). */}
      <ImportWizardSheet
        visible={importOpen}
        onClose={() => setImportOpen(false)}
        teamId={teamForNewClient(teamChoice, ownTeams.map((tm) => tm.id))}
      />
      <ContactsImportSheet
        visible={contactsOpen}
        onClose={() => setContactsOpen(false)}
        teamId={teamForNewClient(teamChoice, ownTeams.map((tm) => tm.id))}
      />
      <BulkSmsSheet
        visible={smsOpen}
        recipients={selectedClients}
        onClose={() => setSmsOpen(false)}
        onSent={() => {
          setSmsOpen(false);
          exitSelection();
        }}
      />
    </Screen>
  );
}
