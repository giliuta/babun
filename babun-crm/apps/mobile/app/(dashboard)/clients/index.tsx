import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  BarChart3,
  Search,
  Settings,
  Users,
} from "lucide-react-native";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import type { Client } from "@babun/shared/local/clients";
import { buildStatsMap } from "@babun/shared/local/selectors/client-stats";
import { countWordRu } from "@babun/shared/common/utils/pluralize";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingBar } from "@/components/ui/LoadingBar";
import { Spinner } from "@/components/ui/Spinner";
import { GradientButton } from "@/components/ui/GradientButton";
import { Screen } from "@/components/ui/Screen";
import { useToast } from "@/components/ui/Toast";
import { usePullRefresh } from "@/lib/pull-refresh";
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
  resetFilters,
  segmentEvidence,
  type ActiveToken,
  type ClientsFilter,
} from "@/features/clients/filter";
import { useClientFilters } from "@/features/clients/useClientFilters";
import {
  loadDayFilter,
  saveDayFilter,
} from "@/features/clients/filter-pref";
import {
  useClientsSort,
  useSetClientsSort,
} from "@/features/clients/sort-pref";
import {
  DEFAULT_CARD_FIELDS,
  useCardFields,
} from "@/features/clients/card-prefs";
import { ClientActionsSheet } from "@/features/clients/ClientActionsSheet";
import { useGuardedBookingNav } from "@/features/clients/card-booking";
import { RemindSheet } from "@/features/clients/RemindSheet";
import { ClientDataNotice } from "@/features/clients/ClientDataNotice";
import { ClientsFilterBar } from "@/features/clients/ClientsFilterBar";
import { ClientsFilterSheet } from "@/features/clients/ClientsFilterSheet";
import { ImportWizardSheet } from "@/features/clients/import/ImportWizardSheet";
import { ContactsImportSheet } from "@/features/clients/import/ContactsImportSheet";
import { BulkActionBar } from "@/features/clients/BulkActionBar";
import { BulkSmsSheet } from "@/features/clients/BulkSmsSheet";
import { shareClientsCsv } from "@/features/clients/bulk-export";
import { useAppointments } from "@/features/calendar/queries";
import { useCities, useTeams } from "@/features/reference/queries";
import { useCurrentRole } from "@/features/settings/tenant";
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

export default function ClientsListScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const toast = useToast();
  const { data: role } = useCurrentRole();
  // Экран настроек возвращается сюда с nonce-параметром:
  // «Импорт из CSV» → openImport.
  const params = useLocalSearchParams<{
    openImport?: string;
    /** «Из контактов телефона» → openContacts. */
    openContacts?: string;
  }>();
  const { data, isLoading, isRefetching, refetch, error } = useClients();
  // Контрол обновления отражает ЖЕСТ, а не любое дообновление: иначе список
  // сам уезжал вниз с застывшей системной вертушкой.
  const pull = usePullRefresh(refetch);
  const { data: tags = [] } = useClientTags();
  const { data: appointments = [] } = useAppointments();
  const { data: teams = [] } = useTeams();
  const { data: cities = [] } = useCities();
  const { data: cardFields = DEFAULT_CARD_FIELDS } = useCardFields();
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

  const clients = useMemo(() => data ?? [], [data]);

  // Per-client roll-up (visits / money / debt / last team) — one pass
  // over appointments, shared by the cards, the sort and the filter.
  const statsMap = useMemo(
    () => buildStatsMap(clients, appointments),
    [clients, appointments],
  );

  // Первая и последняя (не отменённые) записи — сплит периода в фильтрах
  // показывает у «Всего времени» честный охват данных в обе стороны.
  const dataSpan = useMemo(() => {
    let min: string | null = null;
    let max: string | null = null;
    for (const a of appointments) {
      if (a.status === "cancelled" || !a.date) continue;
      if (!min || a.date < min) min = a.date;
      if (!max || a.date > max) max = a.date;
    }
    return { from: min, to: max };
  }, [appointments]);

  // Web useClientFilters port. Внутри сортировка живёт в отдельном мемо
  // (deps без поиска) — фикс Волны 1 сохранён: клавиши не гоняют
  // localeCompare-компаратор.
  const result = useClientFilters(
    clients,
    appointments,
    teams,
    cities,
    tags,
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
      const selectedTeams = f.selectedTeams.filter((x) => teamSet.has(x));
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

  const removeToken = (token: ActiveToken) => {
    if (token.key === "team")
      setFilter((f) => ({
        ...f,
        selectedTeams: f.selectedTeams.filter((x) => x !== token.val),
      }));
    else if (token.key === "city")
      setFilter((f) => ({
        ...f,
        selectedCities: f.selectedCities.filter((x) => x !== token.val),
      }));
    else if (token.key === "tag")
      setFilter((f) => ({
        ...f,
        activeTags: f.activeTags.filter((x) => x !== token.val),
      }));
    else if (token.key === "period") setFilter((f) => ({ ...f, period: null }));
    else if (token.key === "segment")
      setFilter((f) => ({
        ...f,
        segments: f.segments.filter((x) => x !== token.val),
      }));
    else if (token.key === "source")
      setFilter((f) => ({
        ...f,
        sources: f.sources.filter((x) => x !== token.val),
      }));
    else if (token.key === "property")
      setFilter((f) => ({
        ...f,
        propertyTypes: f.propertyTypes.filter((x) => x !== token.val),
      }));
  };

  // Один сброс на все три кнопки (лист, бар, пустой экран): чистит и
  // фильтры, и поиск — иначе «Сбросить» на баре оставлял запрос и список
  // оставался пустым без видимой причины.
  const resetAll = () => {
    haptics.tap();
    setFilter(resetFilters());
    setQuery("");
  };

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
      teamId: statsMap.get(c.id)?.lastTeamId ?? null,
    });
  };

  const confirmArchiveOne = (c: Client) => {
    Alert.alert(
      "Архивировать клиента?",
      `${c.full_name || "Клиент"} исчезнет из рабочего списка. Вся история сохранится; вернуть можно сразу кнопкой «Отменить», а позже — в шестерёнке, «Архив клиентов».`,
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Архивировать",
          style: "destructive",
          onPress: async () => {
            try {
              await archiveWithUndo([c]);
            } catch (e) {
              Alert.alert("Не удалось архивировать", (e as Error).message);
            }
          },
        },
      ],
    );
  };

  // УДАЛИТЬ ≠ АРХИВ: клиент едет в «Недавно удалённые» и через 30 дней
  // стирается сам. За клиентом с визитами стоит финансовая история — база
  // стереть его не даст, поэтому говорим это ДО действия и предлагаем архив.
  const confirmDeleteOne = (c: Client) => {
    const stats = statsMap.get(c.id);
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
      Alert.alert(
        "Этого клиента нельзя удалить",
        "За этим клиентом есть визиты и деньги — они останутся в отчётах и должны быть к кому-то привязаны. Такого клиента убирают в архив: из списка он исчезнет, история сохранится.",
        [
          { text: "Отмена", style: "cancel" },
          { text: "В архив", onPress: () => confirmArchiveOne(c) },
        ],
      );
      return;
    }
    Alert.alert(
      "Удалить клиента?",
      `${c.full_name || "Клиент"} переедет в «Недавно удалённые» и будет стёрт через ${TRASH_DAYS} дней. До этого его можно вернуть — в шестерёнке.`,
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Удалить",
          style: "destructive",
          onPress: async () => {
            try {
              await archiveWithUndo([c], true);
            } catch (e) {
              Alert.alert("Не удалось удалить", (e as Error).message);
            }
          },
        },
      ],
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
      const shared = await shareClientsCsv(selectedClients, tags, statsMap);
      if (shared) {
        toast(`CSV выгружен (${selectedClients.length})`, "success");
        exitSelection();
      }
    } catch (e) {
      Alert.alert("Не удалось выгрузить", (e as Error).message);
    }
  };

  const onArchive = () => {
    const n = selectedClients.length;
    if (n === 0) return;
    const word = countWordRu(n, "клиента", "клиента", "клиентов");
    Alert.alert(
      `Архивировать ${n} ${word}?`,
      "Клиенты исчезнут из рабочего списка. Заявки, инвойсы и финансовая история сохранятся; вернуть можно сразу кнопкой «Отменить», а позже — в шестерёнке, «Архив клиентов».",
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Архивировать",
          style: "destructive",
          onPress: async () => {
            try {
              // Итог (в т.ч. частичный) и кнопка отмены — в одном тосте;
              // здесь остаётся только случай «не уехал никто».
              const { archived, failed } =
                await archiveWithUndo(selectedClients);
              if (archived === 0) {
                Alert.alert(
                  "Не удалось архивировать",
                  `Ни один из ${failed} клиентов не архивирован. Проверьте соединение и попробуйте ещё раз.`,
                );
                return;
              }
              exitSelection();
            } catch (e) {
              Alert.alert("Не удалось архивировать", (e as Error).message);
            }
          },
        },
      ],
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
            borderBottomWidth: 1,
            borderBottomColor: t.separator,
          }}
        >
          <Pressable
            onPress={() => router.push("/clients/settings")}
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
              className="flex-1 text-[15px]"
              style={{ color: t.ink, paddingVertical: 0 }}
            />
          </View>

          {role === "owner" ? (
            <Pressable
              onPress={() => router.push("/cabinet/insights")}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Аналитика по клиентам"
              style={({ pressed }) => ({
                width: 44,
                height: 44,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: t.radius.card,
                backgroundColor: pressed ? t.pressed : "transparent",
              })}
            >
              <BarChart3 color={t.sub} size={21} strokeWidth={2} />
            </Pressable>
          ) : null}
        </View>
      )}

      {/* Фильтры прячем в режиме выбора — фокус на наборе. Пока грузим
          или упали — бара нет: он печатал «Всего 0 клиентов» поверх
          спиннера и поверх экрана ошибки. */}
      {!selecting && !isLoading && !error ? (
        <ClientsFilterBar
          totalCount={clients.length}
          foundCount={result.filtered.length}
          activeCount={result.activeCount}
          tokens={result.activeTokens}
          onOpen={() => {
            setInitialFacet(null);
            setSheetOpen(true);
          }}
          onOpenToken={(tok) => {
            // «Период» — не фасет-попап (у него свои пресеты/колёса):
            // открываем лист как обычно, остальное — сразу на измерении.
            setInitialFacet(tok.key === "period" ? null : tok.key);
            setSheetOpen(true);
          }}
          onRemoveToken={removeToken}
          onReset={resetAll}
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
            const teamName = stats?.lastTeamId
              ? (teams.find((tm) => tm.id === stats.lastTeamId)?.name ?? null)
              : null;
            return (
              <ClientRow
                client={item}
                stats={stats}
                teamName={teamName}
                tags={tags}
                cardFields={cardFields}
                selectionMode={selecting}
                picked={selectedIds.has(item.id)}
                onPress={() =>
                  selecting
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
                onBook={() => bookFor(item)}
                onRemind={() => setRemindClient(item)}
                onArchive={() => confirmArchiveOne(item)}
                onLongPress={() =>
                  selecting ? toggleId(item.id) : setMenuClient(item)
                }
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
                action={{
                  label: "Сбросить",
                  onPress: () => {
                    setQuery("");
                    setFilter(resetFilters());
                  },
                }}
              />
            ) : (
              <EmptyState
                icon={<Users color={t.faint} size={40} strokeWidth={1.5} />}
                title="Пока нет клиентов"
                subtitle="Телефон — и клиент в базе, остальное добавите на карточке"
                action={{
                  label: "Добавить клиента",
                  onPress: () => router.push("/clients/new"),
                }}
              />
            )
          }
        />
        </>
      )}

      {/* В режиме выбора — нижняя панель массовых действий; вне выбора —
          полноценная кнопка создания внизу (стандарт «Добавить»: как
          «Добавить операцию» в Финансах, вместо отдельной иконки в шапке). */}
      {selecting ? (
        <BulkActionBar
          count={pickedCount}
          onSms={() => setSmsOpen(true)}
          onExport={onExport}
          onArchive={onArchive}
        />
      ) : (
        <View
          style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 }}
        >
          <GradientButton
            label="Добавить клиента"
            onPress={() => router.push("/clients/new")}
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
        onBook={bookFor}
        onClose={() => setMenuClient(null)}
        onSelectMany={(c) => enterSelection(c.id)}
        onTogglePin={onTogglePin}
        onRemind={openRemindMenu}
        onArchive={confirmArchiveOne}
        onDelete={confirmDeleteOne}
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
      />
      <ImportWizardSheet
        visible={importOpen}
        onClose={() => setImportOpen(false)}
      />
      <ContactsImportSheet
        visible={contactsOpen}
        onClose={() => setContactsOpen(false)}
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
