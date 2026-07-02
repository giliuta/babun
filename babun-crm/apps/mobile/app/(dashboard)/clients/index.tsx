import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Clock, Phone, Pin, Plus, Search, Settings } from "lucide-react-native";
import type { Client, ClientTag } from "@babun/shared/local/clients";
import {
  buildStatsMap,
  type ClientStats,
} from "@babun/shared/local/selectors/client-stats";
import {
  getAvatarColor,
  getInitials,
} from "@babun/shared/common/utils/avatar-color";
import { formatEUR } from "@babun/shared/common/utils/money";
import { Screen } from "@/components/ui/Screen";
import { TYPE } from "@/components/ui/tokens";
import { useClients, useClientTags } from "@/features/clients/queries";
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
import { formatShortDateRu } from "@/features/clients/format";
import { ClientsFilterBar } from "@/features/clients/ClientsFilterBar";
import { ClientsFilterSheet } from "@/features/clients/ClientsFilterSheet";
import { ImportSheet } from "@/features/clients/ImportSheet";
import { useAppointments } from "@/features/calendar/queries";
import { useTeams } from "@/features/reference/queries";
import { useThemeColors } from "@/theme/colors";

// v811 gold for the debt figure — matches the web card literal.
const DEBT_GOLD = "#b78600";

// v811 list card (approved web design, apps/web/.../clients/page.tsx
// ClientCard): name row (+pin) · money row (grey expected · green income
// · gold debt) · meta row (посл. запись · команда · город · теги).
// Field visibility is driven by the «Что показывать» prefs (cardFields).
function ClientRow({
  client,
  stats,
  teamName,
  tags,
  cardFields,
  onPress,
}: {
  client: Client;
  stats: ClientStats | undefined;
  teamName: string | null;
  tags: ClientTag[];
  cardFields: CardFieldPrefs;
  onPress: () => void;
}) {
  const t = useThemeColors();
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

  // Meta line — last visit (с иконкой часов, web parity) · team · city ·
  // tags. Каждое поле гейтится своим тогглом.
  const metaSegs: { key: string; node: React.ReactNode }[] = [];
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

  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center px-4 py-3 active:opacity-60"
    >
      <View
        className="h-11 w-11 items-center justify-center rounded-full"
        style={{ backgroundColor: getAvatarColor(client.full_name) }}
      >
        <Text className="text-sm font-bold" style={{ color: "#fff" }}>
          {getInitials(client.full_name || "?")}
        </Text>
      </View>
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
      {phoneDigits ? (
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
}

export default function ClientsListScreen() {
  const t = useThemeColors();
  const router = useRouter();
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
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ClientsFilter>(EMPTY_FILTER);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

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

  return (
    <Screen>
      <View className="flex-row items-center justify-between px-4 pb-2 pt-4">
        <Text style={{ ...TYPE.display, color: t.ink }}>Клиенты</Text>
        <View className="flex-row items-center gap-2">
          {/* v811 — импорт/экспорт переехали в «Настройки клиентов»
              (шестерёнка); в хедере остаётся только «+». */}
          <Pressable
            onPress={() =>
              router.push({
                pathname: "/clients/settings",
                params: { sort: filter.sort },
              })
            }
            accessibilityRole="button"
            accessibilityLabel="Настройки клиентов"
            className="h-10 w-10 items-center justify-center rounded-full active:opacity-80"
            style={{ backgroundColor: t.fill }}
          >
            <Settings color={t.body} size={20} />
          </Pressable>
          <Pressable
            onPress={() => router.push("/clients/new")}
            accessibilityRole="button"
            accessibilityLabel="Добавить клиента"
            className="h-10 w-10 items-center justify-center rounded-full active:opacity-80"
            style={{ backgroundColor: t.accent }}
          >
            <Plus color="#fff" size={22} />
          </Pressable>
        </View>
      </View>

      <View
        className="mx-4 mb-2 flex-row items-center gap-2 rounded-xl px-3"
        style={{ backgroundColor: t.fill }}
      >
        <Search color={t.faint} size={18} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Поиск по имени, телефону, адресу"
          placeholderTextColor={t.placeholder}
          selectionColor={t.accent}
          keyboardAppearance={t.dark ? "dark" : "light"}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          className="flex-1 py-2.5 text-base"
          style={{ color: t.ink }}
        />
      </View>

      <ClientsFilterBar
        totalCount={clients.length}
        foundCount={result.filtered.length}
        activeCount={result.activeCount}
        tokens={result.activeTokens}
        onOpen={() => setSheetOpen(true)}
        onRemoveToken={removeToken}
        onReset={() => setFilter(resetFilters(filter))}
      />

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
                onPress={() => router.push(`/clients/${item.id}`)}
              />
            );
          }}
          ItemSeparatorComponent={() => (
            <View className="ml-[68px] h-px" style={{ backgroundColor: t.separator }} />
          )}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
          }
          ListEmptyComponent={
            <View className="items-center px-6 pt-20">
              <Text className="text-sm" style={{ color: t.faint }}>
                {filtering ? "Ничего не найдено" : "Пока нет клиентов"}
              </Text>
            </View>
          }
        />
      )}

      <ClientsFilterSheet
        visible={sheetOpen}
        filter={filter}
        result={result}
        segmentCounts={segmentCounts}
        onChange={setFilter}
        onClose={() => setSheetOpen(false)}
      />
      <ImportSheet visible={importOpen} onClose={() => setImportOpen(false)} />
    </Screen>
  );
}
