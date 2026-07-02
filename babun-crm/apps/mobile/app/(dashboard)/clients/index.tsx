import { useMemo, useState } from "react";
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
import { useRouter } from "expo-router";
import { Filter, Phone, Pin, Plus, Search, Upload } from "lucide-react-native";
import type { Client, ClientTag } from "@babun/shared/local/clients";
import { matchesClient } from "@babun/shared/local/selectors/client-search";
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
import { useClients, useClientTags } from "@/features/clients/queries";
import {
  EMPTY_FILTER,
  applyClientsFilter,
  cityOptions,
  filterActiveCount,
  type ClientsFilter,
} from "@/features/clients/filter";
import { formatShortDateRu } from "@/features/clients/format";
import { ClientsFilterSheet } from "@/features/clients/ClientsFilterSheet";
import { ImportSheet } from "@/features/clients/ImportSheet";
import { useAppointments } from "@/features/calendar/queries";
import { useTeams } from "@/features/reference/queries";
import { useThemeColors } from "@/theme/colors";

// v811 gold for the debt figure — matches the web card literal.
const DEBT_GOLD = "#b78600";

// v811 list card (approved web design, apps/web/.../clients/page.tsx
// ClientCard): name row (+pin) · money row (grey expected · green income
// · gold debt) · meta row (посл. запись · команда · город · теги). The
// web's «Что показывать» cardFields prefs have no mobile settings screen
// yet, so all fields render (= the web defaults).
function ClientRow({
  client,
  stats,
  teamName,
  tags,
  onPress,
}: {
  client: Client;
  stats: ClientStats | undefined;
  teamName: string | null;
  tags: ClientTag[];
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
  if (exp > 0) figs.push({ key: "exp", text: formatEUR(exp), color: t.sub });
  if (income > 0)
    figs.push({ key: "inc", text: formatEUR(income), color: t.success });
  if (debt > 0)
    figs.push({ key: "debt", text: formatEUR(debt), color: DEBT_GOLD });

  const metaSegs: string[] = [
    stats?.lastVisitDate ? formatShortDateRu(stats.lastVisitDate) : "нет записей",
  ];
  if (teamName) metaSegs.push(teamName);
  const city = (client.city ?? "").trim();
  if (city) metaSegs.push(city);
  for (const tid of client.tag_ids) {
    const tag = tags.find((x) => x.id === tid);
    if (tag) metaSegs.push(tag.name);
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
        <Text
          className="mt-0.5 text-[11px]"
          style={{ color: t.sub }}
          numberOfLines={1}
        >
          {metaSegs.join(" · ")}
        </Text>
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
  const { data, isLoading, isRefetching, refetch, error } = useClients();
  const { data: tags = [] } = useClientTags();
  const { data: appointments = [] } = useAppointments();
  const { data: teams = [] } = useTeams();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ClientsFilter>(EMPTY_FILTER);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const clients = data ?? [];
  const cities = useMemo(() => cityOptions(clients), [clients]);
  const activeCount = filterActiveCount(filter);

  // Per-client roll-up (visits / money / debt / last team) — one pass
  // over appointments, shared by the cards, the sort and the filter.
  const statsMap = useMemo(
    () => buildStatsMap(clients, appointments),
    [clients, appointments],
  );

  // Sort depends on clients+stats ONLY — keystrokes in the search box
  // must not re-run the O(n log n) comparator. Web default order:
  // pinned-first, then «recent» (last visit / created_at desc).
  const sorted = useMemo(() => {
    return [...clients].sort((a, b) => {
      const aPinned = a.pinned_at ? 1 : 0;
      const bPinned = b.pinned_at ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      if (aPinned && bPinned) {
        return (b.pinned_at ?? "").localeCompare(a.pinned_at ?? "");
      }
      const aDate = statsMap.get(a.id)?.lastVisitDate || a.created_at;
      const bDate = statsMap.get(b.id)?.lastVisitDate || b.created_at;
      return bDate.localeCompare(aDate);
    });
  }, [clients, statsMap]);

  const visible = useMemo(() => {
    const byFilter = applyClientsFilter(sorted, filter, statsMap);
    const q = query.trim();
    return q ? byFilter.filter((c) => matchesClient(c, q)) : byFilter;
  }, [sorted, statsMap, query, filter]);

  const filtering = activeCount > 0 || query.trim().length > 0;

  return (
    <Screen>
      <View className="flex-row items-center justify-between px-4 pb-2 pt-4">
        <View>
          <Text className="text-2xl font-bold" style={{ color: t.ink }}>Клиенты</Text>
          <Text className="text-sm" style={{ color: t.sub }}>
            {filtering
              ? `Найдено: ${visible.length} из ${clients.length}`
              : `${clients.length} всего`}
          </Text>
        </View>
        <View className="flex-row items-center gap-2">
          <Pressable
            onPress={() => setImportOpen(true)}
            className="h-10 w-10 items-center justify-center rounded-full active:opacity-80"
            style={{ backgroundColor: t.dark ? "rgba(255,255,255,0.07)" : "#eef1f5" }}
          >
            <Upload color={t.body} size={20} />
          </Pressable>
          <Pressable
            onPress={() => router.push("/clients/new")}
            className="h-10 w-10 items-center justify-center rounded-full active:opacity-80"
            style={{ backgroundColor: t.accent }}
          >
            <Plus color="#fff" size={22} />
          </Pressable>
        </View>
      </View>

      <View
        className="mx-4 mb-2 flex-row items-center gap-2 rounded-xl px-3"
        style={{ backgroundColor: t.dark ? "rgba(255,255,255,0.07)" : "#eef1f5" }}
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

      {/* «Сбросить» is a SIBLING of the filter pressable (not nested) so
          VoiceOver reads two targets and a miss can't open the sheet. */}
      <View
        className="mx-4 mb-2 flex-row items-center gap-2 rounded-xl border px-3"
        style={
          activeCount
            ? { borderColor: t.accent + "66", backgroundColor: t.dark ? `${t.accent}1a` : `${t.accent}0d` }
            : { borderColor: t.separator, backgroundColor: t.surface }
        }
      >
        <Pressable
          onPress={() => setSheetOpen(true)}
          className="flex-1 flex-row items-center gap-2 py-2.5 active:opacity-60"
        >
          <Filter color={activeCount ? t.accent : t.faint} size={16} />
          <Text
            className="flex-1 text-sm"
            style={{ color: activeCount ? t.accent : t.sub, fontWeight: activeCount ? "600" : "400" }}
          >
            {activeCount ? `Фильтры · ${activeCount}` : "Фильтры"}
          </Text>
        </Pressable>
        {activeCount ? (
          <Pressable
            hitSlop={12}
            onPress={() => setFilter(EMPTY_FILTER)}
            accessibilityRole="button"
            accessibilityLabel="Сбросить фильтры"
            className="py-2.5 pl-2 active:opacity-60"
          >
            <Text className="text-xs" style={{ color: t.faint }}>Сбросить</Text>
          </Pressable>
        ) : null}
      </View>

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
          data={visible}
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
        onChange={setFilter}
        onClose={() => setSheetOpen(false)}
        tags={tags}
        cities={cities}
      />
      <ImportSheet visible={importOpen} onClose={() => setImportOpen(false)} />
    </Screen>
  );
}
