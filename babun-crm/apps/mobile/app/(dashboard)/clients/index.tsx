import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from "react-native";
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  BarChart3,
  Bell,
  Check,
  Clock,
  MessageCircle,
  MessageSquare,
  Phone,
  Pin,
  Search,
  Settings,
  Users,
} from "lucide-react-native";
import type { Client, ClientTag } from "@babun/shared/local/clients";
import { CHANNEL_COLORS } from "@babun/shared/local/chats";
import { whatsappUrl } from "@babun/shared/common/utils/messenger-links";
import {
  buildStatsMap,
  type ClientStats,
} from "@babun/shared/local/selectors/client-stats";
import {
  getAvatarColor,
  getInitials,
} from "@babun/shared/common/utils/avatar-color";
import { formatEUR } from "@babun/shared/common/utils/money";
import { countWordRu } from "@babun/shared/common/utils/pluralize";
import { EmptyState } from "@/components/ui/EmptyState";
import { GradientButton } from "@/components/ui/GradientButton";
import { Screen } from "@/components/ui/Screen";
import { ICON } from "@/components/ui/tokens";
import { useToast } from "@/components/ui/Toast";
import {
  useClients,
  useClientTags,
  useDeleteClients,
  useUpdateClientById,
} from "@/features/clients/queries";
import {
  buildSegmentCounts,
  EMPTY_FILTER,
  resetFilters,
  type ActiveToken,
  type ClientsFilter,
} from "@/features/clients/filter";
import { useClientFilters } from "@/features/clients/useClientFilters";
import {
  DEFAULT_CARD_FIELDS,
  useCardFields,
  type CardFieldPrefs,
} from "@/features/clients/card-prefs";
import {
  formatShortDateRu,
  reminderBadge,
  ymdInDays,
} from "@/features/clients/format";
import { ClientActionsSheet } from "@/features/clients/ClientActionsSheet";
import { ClientsFilterBar } from "@/features/clients/ClientsFilterBar";
import { ClientsFilterSheet } from "@/features/clients/ClientsFilterSheet";
import { ImportWizardSheet } from "@/features/clients/import/ImportWizardSheet";
import { BulkActionBar } from "@/features/clients/BulkActionBar";
import { BulkSmsSheet } from "@/features/clients/BulkSmsSheet";
import { shareClientsCsv } from "@/features/clients/bulk-export";
import { useAppointments } from "@/features/calendar/queries";
import { useTeams } from "@/features/reference/queries";
import { useThemeColors } from "@/theme/colors";

// v811 gold for the debt figure — matches the web card literal.
const DEBT_GOLD = "#b78600";

// v811 list card (approved web design, apps/web/.../clients/page.tsx
// ClientCard): name row (+pin) · money row (grey expected · green income
// · gold debt) · meta row (посл. запись · команда · город · теги).
// Field visibility is driven by the «Что показывать» prefs (cardFields).
//
// Bulk-mode (web-parity): long-press ENTERS selection mode; in it the avatar
// becomes a checkbox, the phone-call button hides, and a tap toggles the pick
// instead of opening the card. A right-swipe surfaces «Позвонить» as a visible
// dup of the tap-to-call button (only outside selection, only with a phone).
function ClientRow({
  client,
  stats,
  teamName,
  tags,
  cardFields,
  selectionMode,
  picked,
  onPress,
  onLongPress,
}: {
  client: Client;
  stats: ClientStats | undefined;
  teamName: string | null;
  tags: ClientTag[];
  cardFields: CardFieldPrefs;
  selectionMode: boolean;
  picked: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const t = useThemeColors();
  const swipeRef = useRef<SwipeableMethods | null>(null);
  const exp = Math.round(stats?.expectedRevenue ?? 0);
  const income = Math.round(stats?.totalSpent ?? 0);
  const debt =
    (stats?.debt ?? 0) > 0
      ? stats!.debt
      : client.balance < 0
        ? Math.abs(client.balance)
        : 0;
  const phoneDigits = client.phone?.replace(/\D/g, "") ?? "";

  const figs: { key: string; text: string; color: string }[] = [];
  if (cardFields.exp && exp > 0)
    figs.push({ key: "exp", text: formatEUR(exp), color: t.sub });
  if (cardFields.inc && income > 0)
    figs.push({ key: "inc", text: formatEUR(income), color: t.success });
  // «долг €450», не голый цветовой код: золото без подписи в списке
  // не читается, а должника надо находить по слову, не по памяти.
  if (cardFields.debt && debt > 0)
    figs.push({ key: "debt", text: `долг ${formatEUR(debt)}`, color: DEBT_GOLD });

  // Meta line — reminder (колокольчик) · last visit (с иконкой часов,
  // web parity) · team · city · tags. Напоминание не гейтится тогглами:
  // как и pin, это сигнал, поставленный владельцем руками, — красный,
  // когда пора действовать (сегодня/прошло), серый — когда впереди.
  const metaSegs: { key: string; node: React.ReactNode }[] = [];
  const reminder = reminderBadge(client.reminder_at);
  if (reminder) {
    metaSegs.push({
      key: "reminder",
      node: (
        <View className="flex-row items-center gap-1">
          <Bell
            color={reminder.due ? t.danger : t.sub}
            size={11}
            strokeWidth={2.2}
          />
          <Text
            className={`text-[11px] ${reminder.due ? "font-semibold" : ""}`}
            style={{ color: reminder.due ? t.danger : t.ink }}
          >
            {reminder.label}
          </Text>
        </View>
      ),
    });
  }
  if (cardFields.last) {
    metaSegs.push({
      key: "last",
      node: stats?.lastVisitDate ? (
        <View className="flex-row items-center gap-1">
          <Clock color={t.sub} size={11} strokeWidth={2.2} />
          <Text className="text-[11px]" style={{ color: t.ink }}>
            {formatShortDateRu(stats.lastVisitDate)}
          </Text>
        </View>
      ) : (
        <Text className="text-[11px]" style={{ color: t.faint }}>
          нет записей
        </Text>
      ),
    });
  }
  if (cardFields.meta) {
    const push = (key: string, text: string) =>
      metaSegs.push({
        key,
        node: (
          <Text className="text-[11px]" style={{ color: t.ink }} numberOfLines={1}>
            {text}
          </Text>
        ),
      });
    if (teamName) push("team", teamName);
    const city = (client.city ?? "").trim();
    if (city) push("city", city);
    for (const tid of client.tag_ids) {
      const tag = tags.find((x) => x.id === tid);
      if (tag) push(`tag-${tid}`, tag.name);
    }
  }

  const row = (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={280}
      accessibilityRole="button"
      accessibilityState={selectionMode ? { selected: picked } : undefined}
      className="flex-row items-center px-4 py-3 active:opacity-60"
      style={{ backgroundColor: t.canvas }}
    >
      {selectionMode ? (
        // Чекбокс замещает аватар (web parity) — ряд не разъезжается.
        <View
          className="h-11 w-11 items-center justify-center rounded-full"
          style={{
            backgroundColor: picked ? t.accent : t.fill,
            borderWidth: picked ? 0 : 2,
            borderColor: t.separator,
          }}
        >
          {picked ? <Check color="#fff" size={20} strokeWidth={3} /> : null}
        </View>
      ) : (
        <View
          className="h-11 w-11 items-center justify-center rounded-full"
          style={{ backgroundColor: getAvatarColor(client.full_name) }}
        >
          <Text className="text-sm font-bold" style={{ color: "#fff" }}>
            {getInitials(client.full_name || "?")}
          </Text>
        </View>
      )}
      <View className="ml-3 flex-1">
        <View className="flex-row items-center gap-1.5">
          {client.pinned_at ? (
            <Pin color={t.accent} size={12} strokeWidth={2.5} />
          ) : null}
          <Text
            className="shrink text-base font-semibold"
            style={{ color: t.ink }}
            numberOfLines={1}
          >
            {client.full_name || "Без имени"}
          </Text>
        </View>
        {figs.length > 0 ? (
          <View className="mt-0.5 flex-row flex-wrap items-center gap-2.5">
            {figs.map((f) => (
              <Text
                key={f.key}
                className="text-[11px] font-semibold"
                style={{ color: f.color, fontVariant: ["tabular-nums"] }}
              >
                {f.text}
              </Text>
            ))}
          </View>
        ) : null}
        {metaSegs.length > 0 ? (
          <View className="mt-0.5 flex-row flex-wrap items-center">
            {metaSegs.map((seg, i) => (
              <View key={seg.key} className="flex-row items-center">
                {i > 0 ? (
                  <Text className="mx-[5px] text-[11px]" style={{ color: t.faint }}>
                    ·
                  </Text>
                ) : null}
                {seg.node}
              </View>
            ))}
          </View>
        ) : null}
      </View>
      {phoneDigits && !selectionMode ? (
        <Pressable
          onPress={() => Linking.openURL(`tel:${phoneDigits}`)}
          hitSlop={6}
          accessibilityLabel="Позвонить"
          className="ml-2 h-9 w-9 items-center justify-center rounded-full active:opacity-70"
          style={{ backgroundColor: `${t.success}1a` }}
        >
          <Phone color={t.success} size={16} />
        </Pressable>
      ) : null}
    </Pressable>
  );

  // Свайпы (RN-GH, паттерн из chats/index.tsx): влево → «Позвонить»
  // (кнопка справа), вправо → «SMS» и «WhatsApp» (кнопки слева).
  // Отключены в режиме выбора (мешали бы тапу-тоглу) и без телефона.
  if (selectionMode || !phoneDigits) return row;
  const wa = whatsappUrl(client.whatsapp_phone || client.phone);
  const swipeAction = (url: string) => {
    swipeRef.current?.close();
    Linking.openURL(url);
  };
  return (
    <ReanimatedSwipeable
      ref={swipeRef}
      friction={2}
      rightThreshold={44}
      leftThreshold={44}
      overshootRight={false}
      overshootLeft={false}
      renderRightActions={() => (
        <Pressable
          onPress={() => swipeAction(`tel:${phoneDigits}`)}
          accessibilityRole="button"
          accessibilityLabel="Позвонить"
          className="w-[88px] items-center justify-center gap-1"
          style={{ backgroundColor: t.success }}
        >
          <Phone color="#fff" size={ICON.sm} />
          <Text className="text-[11px] font-semibold" style={{ color: "#fff" }}>
            Позвонить
          </Text>
        </Pressable>
      )}
      renderLeftActions={() => (
        <View className="flex-row">
          <Pressable
            onPress={() => swipeAction(`sms:${phoneDigits}`)}
            accessibilityRole="button"
            accessibilityLabel="Сообщение"
            className="w-[88px] items-center justify-center gap-1"
            style={{ backgroundColor: t.accent }}
          >
            <MessageSquare color="#fff" size={ICON.sm} />
            <Text className="text-[11px] font-semibold" style={{ color: "#fff" }}>
              SMS
            </Text>
          </Pressable>
          {wa ? (
            <Pressable
              onPress={() => swipeAction(wa)}
              accessibilityRole="button"
              accessibilityLabel="WhatsApp"
              className="w-[88px] items-center justify-center gap-1"
              style={{ backgroundColor: CHANNEL_COLORS.whatsapp }}
            >
              <MessageCircle color="#fff" size={ICON.sm} />
              <Text className="text-[11px] font-semibold" style={{ color: "#fff" }}>
                WhatsApp
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}
    >
      {row}
    </ReanimatedSwipeable>
  );
}

export default function ClientsListScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const toast = useToast();
  // Экран настроек возвращается сюда с nonce-параметрами: «Фильтры /
  // Сортировка» → openFilters, «Импорт из CSV» → openImport.
  const params = useLocalSearchParams<{
    openFilters?: string;
    openImport?: string;
  }>();
  const { data, isLoading, isRefetching, refetch, error } = useClients();
  const { data: tags = [] } = useClientTags();
  const { data: appointments = [] } = useAppointments();
  const { data: teams = [] } = useTeams();
  const { data: cardFields = DEFAULT_CARD_FIELDS } = useCardFields();
  const deleteClients = useDeleteClients();
  const updateById = useUpdateClientById();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ClientsFilter>(EMPTY_FILTER);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // ── Bulk-mode (multi-select) ──────────────────────────────────────
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [smsOpen, setSmsOpen] = useState(false);

  useEffect(() => {
    if (params.openFilters) setSheetOpen(true);
  }, [params.openFilters]);
  useEffect(() => {
    if (params.openImport) setImportOpen(true);
  }, [params.openImport]);

  const clients = data ?? [];

  // Per-client roll-up (visits / money / debt / last team) — one pass
  // over appointments, shared by the cards, the sort and the filter.
  const statsMap = useMemo(
    () => buildStatsMap(clients, appointments),
    [clients, appointments],
  );

  const segmentCounts = useMemo(
    () => buildSegmentCounts(clients, statsMap),
    [clients, statsMap],
  );

  // Web useClientFilters port. Внутри сортировка живёт в отдельном мемо
  // (deps без поиска) — фикс Волны 1 сохранён: клавиши не гоняют
  // localeCompare-компаратор.
  const result = useClientFilters(
    clients,
    appointments,
    teams,
    tags,
    statsMap,
    filter,
    query,
    sheetOpen,
  );

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
      setFilter((f) => ({ ...f, segment: "all" }));
  };

  const filtering = result.activeCount > 0 || query.trim().length > 0;

  // ── Long-press меню клиента (web v313 parity) — нижний лист
  // ClientActionsSheet; здесь только состояние и обработчики.
  const [menuClient, setMenuClient] = useState<Client | null>(null);

  const openRemindMenu = (c: Client) => {
    Alert.alert("Напомнить о клиенте", c.full_name || undefined, [
      {
        text: "Завтра",
        onPress: () =>
          updateById.mutate({ id: c.id, patch: { reminder_at: ymdInDays(1) } }),
      },
      {
        text: "Через неделю",
        onPress: () =>
          updateById.mutate({ id: c.id, patch: { reminder_at: ymdInDays(7) } }),
      },
      {
        text: "Через месяц",
        onPress: () =>
          updateById.mutate({ id: c.id, patch: { reminder_at: ymdInDays(30) } }),
      },
      ...(c.reminder_at
        ? [
            {
              text: "Убрать напоминание",
              style: "destructive" as const,
              onPress: () =>
                updateById.mutate({ id: c.id, patch: { reminder_at: null } }),
            },
          ]
        : []),
      { text: "Отмена", style: "cancel" as const },
    ]);
  };

  const confirmDeleteOne = (c: Client) => {
    Alert.alert(
      "Удалить клиента?",
      `${c.full_name || "Клиент"} и вся его история будут удалены безвозвратно.`,
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Удалить",
          style: "destructive",
          onPress: async () => {
            try {
              const { deleted } = await deleteClients.mutateAsync([c.id]);
              if (deleted > 0) toast("Клиент удалён", "success");
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
  const allSelected =
    visible.length > 0 && selectedIds.size === visible.length;

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

  const selectedClients = useMemo(
    () => clients.filter((c) => selectedIds.has(c.id)),
    [clients, selectedIds],
  );

  const onExport = async () => {
    if (selectedClients.length === 0) return;
    try {
      const shared = await shareClientsCsv(selectedClients, tags);
      if (shared) {
        toast(`CSV выгружен (${selectedClients.length})`, "success");
        exitSelection();
      }
    } catch (e) {
      Alert.alert("Не удалось выгрузить", (e as Error).message);
    }
  };

  const onDelete = () => {
    const n = selectedClients.length;
    if (n === 0) return;
    const word = countWordRu(n, "клиента", "клиента", "клиентов");
    Alert.alert(
      `Удалить ${n} ${word}?`,
      "Это действие необратимо. Связанные записи будут откреплены.",
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Удалить",
          style: "destructive",
          onPress: async () => {
            try {
              const { deleted, failed } = await deleteClients.mutateAsync(
                selectedClients.map((c) => c.id),
              );
              if (failed > 0 && deleted > 0) {
                toast(
                  `Удалено: ${deleted}, не удалось: ${failed}`,
                  "error",
                );
              } else if (failed > 0) {
                Alert.alert(
                  "Не удалось удалить",
                  `Ни один из ${failed} клиентов не удалён. Проверьте соединение и попробуйте ещё раз.`,
                );
                return;
              } else {
                toast(`Удалено: ${deleted}`, "success");
              }
              exitSelection();
            } catch (e) {
              Alert.alert("Не удалось удалить", (e as Error).message);
            }
          },
        },
      ],
    );
  };

  return (
    <Screen>
      {selecting ? (
        // Селекшн-хедер: Отмена · «Выбрано N» · Выбрать всё/Снять.
        <View className="flex-row items-center justify-between px-4 pb-2 pt-4">
          <Pressable
            onPress={exitSelection}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Отменить выбор"
            className="active:opacity-60"
          >
            <Text className="text-base font-semibold" style={{ color: t.accent }}>
              Отмена
            </Text>
          </Pressable>
          <Text className="text-base font-semibold" style={{ color: t.ink }}>
            {selectedIds.size > 0
              ? `Выбрано ${selectedIds.size}`
              : "Выберите клиентов"}
          </Text>
          <Pressable
            onPress={toggleAll}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={allSelected ? "Снять всё" : "Выбрать всё"}
            className="active:opacity-60"
          >
            <Text className="text-base font-semibold" style={{ color: t.accent }}>
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
            onPress={() =>
              router.push({
                pathname: "/clients/settings",
                params: { sort: filter.sort },
              })
            }
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Настройки клиентов"
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 22,
              backgroundColor: pressed ? t.pressed : "transparent",
            })}
          >
            <Settings color={t.sub} size={21} strokeWidth={2} />
          </Pressable>

          <View
            className="h-9 flex-1 flex-row items-center gap-1.5 rounded-[10px] px-2.5"
            style={{ backgroundColor: t.fill }}
          >
            <Search color={t.faint} size={16} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Имя, телефон, адрес"
              placeholderTextColor={t.placeholder}
              selectionColor={t.accent}
              keyboardAppearance={t.dark ? "dark" : "light"}
              autoCapitalize="none"
              clearButtonMode="while-editing"
              className="flex-1 text-[15px]"
              style={{ color: t.ink, paddingVertical: 0 }}
            />
          </View>

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
              borderRadius: 22,
              backgroundColor: pressed ? t.pressed : "transparent",
            })}
          >
            <BarChart3 color={t.sub} size={21} strokeWidth={2} />
          </Pressable>
        </View>
      )}

      {/* Фильтры прячем в режиме выбора — фокус на наборе. */}
      {!selecting ? (
        <ClientsFilterBar
          totalCount={clients.length}
          foundCount={result.filtered.length}
          activeCount={result.activeCount}
          tokens={result.activeTokens}
          onOpen={() => setSheetOpen(true)}
          onRemoveToken={removeToken}
          onReset={() => setFilter(resetFilters(filter))}
        />
      ) : null}

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : error ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-center text-sm" style={{ color: t.danger }}>
            {(error as Error).message}
          </Text>
        </View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={result.filtered}
          keyExtractor={(c) => c.id}
          keyboardShouldPersistTaps="handled"
          // Низ списка не должен прятаться под нижней панелью массовых
          // действий в режиме выбора; вне выбора — небольшой отступ.
          contentContainerStyle={{ paddingBottom: selecting ? 108 : 24 }}
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
                onLongPress={() =>
                  selecting ? toggleId(item.id) : setMenuClient(item)
                }
              />
            );
          }}
          ItemSeparatorComponent={() => (
            <View className="ml-[68px] h-px" style={{ backgroundColor: t.separator }} />
          )}
          refreshControl={
            // В режиме выбора pull-to-refresh отключаем — refetch мог бы
            // выронить выбранные строки из-под чекбоксов.
            selecting ? undefined : (
              <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
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
                    setFilter(resetFilters(filter));
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
      )}

      {/* В режиме выбора — нижняя панель массовых действий; вне выбора —
          полноценная кнопка создания внизу (стандарт «Добавить»: как
          «＋ Операция» в Финансах, вместо глифа «+» в шапке). */}
      {selecting ? (
        <BulkActionBar
          count={selectedIds.size}
          onSms={() => setSmsOpen(true)}
          onExport={onExport}
          onDelete={onDelete}
        />
      ) : (
        <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 }}>
          <GradientButton
            label="＋ Клиент"
            onPress={() => router.push("/clients/new")}
          />
        </View>
      )}

      <ClientActionsSheet
        client={menuClient}
        onClose={() => setMenuClient(null)}
        onSelectMany={(c) => enterSelection(c.id)}
        onTogglePin={onTogglePin}
        onRemind={openRemindMenu}
        onDelete={confirmDeleteOne}
      />
      <ClientsFilterSheet
        visible={sheetOpen}
        filter={filter}
        result={result}
        segmentCounts={segmentCounts}
        onChange={setFilter}
        onClose={() => setSheetOpen(false)}
      />
      <ImportWizardSheet visible={importOpen} onClose={() => setImportOpen(false)} />
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
