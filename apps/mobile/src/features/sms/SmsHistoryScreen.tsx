import { useMemo, useState } from "react";
import { SectionList, Text, TextInput, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Search } from "lucide-react-native";
import { formatCountRu } from "@babun/shared/common/utils/plural-ru";
import { Divider } from "@/components/ui/Divider";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { ScopeChips } from "@/components/ui/ScopeChips";
import { GUTTER } from "@/components/ui/tokens";
import { SummaryToggle } from "@/features/finances/FinanceOverview";
import { useTeams } from "@/features/reference/queries";
import { usePullRefresh } from "@/lib/pull-refresh";
import { useThemeColors } from "@/theme/colors";
import { useSmsHistoryPages } from "./sms-account";
import { countBuckets, filterHistory, groupByDay, type SmsBucket } from "./sms-history-view";
import type { SmsHistoryItem } from "./sms-model";
import { SmsHistoryRow } from "./SmsHistoryRow";
import { SmsMessageSheet } from "./SmsMessageSheet";
import { euro } from "./sms-words";

// ВСЕ SMS КОМПАНИИ (STORY-089; владелец 29.09: «полноценно красивую
// страницу, где хранятся все SMS»). Устроена как лента финансов — тот же
// язык, что владелец уже принял:
//   • поиск — имя клиента, номер, текст;
//   • команды чипами (со страницы команды приходит уже выбранная);
//   • плитки-фильтры — Все · Доставлено · Ждут · Не доставлено; тап по плитке
//     оставляет в ленте только её, второй тап — снова все;
//   • дни шапками («СЕГОДНЯ», «ВЧЕРА», «ЧТ, 24 СЕНТЯБРЯ») с итогом дня;
//   • тап по сообщению — лист: текст пузырём, итог, команда, номер, части,
//     цена, двери к клиенту и записи; недошедшее — «Отправить ещё раз».
// Сообщения приходят страницами по сто: долистал до конца — пришли ещё.
// Плитки и поиск считают то, что уже загружено.

const ALL = "all";

export function SmsHistoryScreen() {
  const t = useThemeColors();
  const params = useLocalSearchParams<{ teamId?: string }>();
  const { data: teams = [] } = useTeams();
  const [teamId, setTeamId] = useState<string | null>(params.teamId || null);
  const [bucket, setBucket] = useState<SmsBucket>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<SmsHistoryItem | null>(null);
  const history = useSmsHistoryPages(teamId);
  const pull = usePullRefresh(history.refetch);

  const loaded = useMemo(() => history.data?.pages.flat() ?? [], [history.data]);
  const counts = useMemo(() => countBuckets(loaded), [loaded]);
  const days = useMemo(
    () => groupByDay(filterHistory(loaded, bucket, query), new Date()),
    [loaded, bucket, query],
  );
  const teamName = (id: string | null) => (id ? (teams.find((x) => x.id === id)?.name ?? null) : null);
  const toggle = (next: SmsBucket) => setBucket((cur) => (cur === next ? "all" : next));

  const header = (
    <View style={{ paddingTop: 12 }}>
      <View
        style={{
          marginHorizontal: GUTTER,
          marginBottom: 12,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 12,
          minHeight: 40,
          borderRadius: t.radius.input,
          borderCurve: "continuous",
          backgroundColor: t.fill,
        }}
      >
        <Search size={18} color={t.sub} strokeWidth={2} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Клиент, номер, текст"
          placeholderTextColor={t.placeholder}
          selectionColor={t.accent}
          keyboardAppearance="light"
          returnKeyType="search"
          clearButtonMode="while-editing"
          accessibilityLabel="Поиск по SMS"
          style={{ flex: 1, fontSize: 16, color: t.ink, paddingVertical: 8 }}
        />
      </View>

      {/* Выбор по календарям — всегда, даже при одном (владелец 30.09:
          «календари — в вся история, там выбор по календарям»). */}
      {teams.length > 0 ? (
        <View style={{ marginBottom: 12 }}>
          <ScopeChips
            onCanvas
            seam={false}
            items={[{ id: ALL, name: "Все" }, ...teams.map((x) => ({ id: x.id, name: x.name, color: x.color }))]}
            activeId={teamId ?? ALL}
            onSelect={(id) => setTeamId(id === ALL ? null : id)}
          />
        </View>
      ) : null}

      <View style={{ marginHorizontal: GUTTER, gap: 6, marginBottom: 8 }}>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <SummaryToggle
            label="Все"
            color={t.accent}
            value={String(counts.all)}
            quiet={counts.all === 0}
            a11yValue={formatCountRu(counts.all, ["сообщение", "сообщения", "сообщений"])}
            active={bucket === "all"}
            onPress={() => setBucket("all")}
          />
          <SummaryToggle
            label="Доставлено"
            color={t.success}
            value={String(counts.delivered)}
            quiet={counts.delivered === 0}
            active={bucket === "delivered"}
            onPress={() => toggle("delivered")}
          />
        </View>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <SummaryToggle
            label="Ждут"
            color={t.warning}
            value={String(counts.waiting)}
            quiet={counts.waiting === 0}
            active={bucket === "waiting"}
            onPress={() => toggle("waiting")}
          />
          <SummaryToggle
            label="Не доставлено"
            color={t.danger}
            value={String(counts.failed)}
            quiet={counts.failed === 0}
            active={bucket === "failed"}
            onPress={() => toggle("failed")}
          />
        </View>
      </View>
    </View>
  );

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="История SMS" subtitle={teamName(teamId) ?? undefined} />
      {history.isLoading ? (
        <EmptyState state="loading" fill />
      ) : history.isError ? (
        <EmptyState
          state="error"
          fill
          subtitle={history.error instanceof Error ? history.error.message : undefined}
          action={{ label: "Повторить", onPress: () => void history.refetch() }}
        />
      ) : (
        <SectionList
          sections={days}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={header}
          stickySectionHeadersEnabled={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingBottom: 24 }}
          renderSectionHeader={({ section }) => (
            <View
              style={{
                flexDirection: "row",
                alignItems: "baseline",
                paddingHorizontal: GUTTER + 4,
                paddingTop: 16,
                paddingBottom: 6,
              }}
            >
              <Text maxFontSizeMultiplier={1.2} style={{ flex: 1, fontSize: 13, fontWeight: "600", letterSpacing: 0.4, color: t.sub }}>
                {section.title}
              </Text>
              <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 13, fontWeight: "600", color: t.sub, fontVariant: ["tabular-nums"] }}>
                {section.cents > 0 ? `${section.count} SMS · ${euro(section.cents)}` : `${section.count} SMS`}
              </Text>
            </View>
          )}
          renderItem={({ item, index, section }) => (
            <View
              style={{
                marginHorizontal: GUTTER,
                backgroundColor: t.surface,
                borderTopLeftRadius: index === 0 ? t.radius.card : 0,
                borderTopRightRadius: index === 0 ? t.radius.card : 0,
                borderBottomLeftRadius: index === section.data.length - 1 ? t.radius.card : 0,
                borderBottomRightRadius: index === section.data.length - 1 ? t.radius.card : 0,
                borderCurve: "continuous",
              }}
            >
              {index > 0 ? <Divider inset={16} /> : null}
              <SmsHistoryRow item={item} onPress={() => setOpen(item)} />
            </View>
          )}
          ListEmptyComponent={
            <EmptyState
              title={loaded.length === 0 ? "Сообщений пока нет" : "Ничего не нашлось"}
              subtitle={
                loaded.length === 0
                  ? "Здесь появятся все SMS: автоматические и отправленные вручную."
                  : "Поменяйте поиск или плитку."
              }
            />
          }
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (history.hasNextPage && !history.isFetchingNextPage) void history.fetchNextPage();
          }}
          ListFooterComponent={history.isFetchingNextPage ? <EmptyState state="loading" /> : null}
          refreshing={pull.refreshing}
          onRefresh={pull.onRefresh}
        />
      )}
      <SmsMessageSheet item={open} teamName={teamName} onClose={() => setOpen(null)} />
    </Screen>
  );
}

export default SmsHistoryScreen;
