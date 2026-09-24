import { FlatList, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Divider } from "@/components/ui/Divider";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { GUTTER } from "@/components/ui/tokens";
import { usePullRefresh } from "@/lib/pull-refresh";
import { useTeams } from "@/features/reference/queries";
import { useThemeColors } from "@/theme/colors";
import { useSmsHistory } from "./sms-account";
import { SmsHistoryRow } from "./SmsHistoryRow";

// ВСЯ ИСТОРИЯ SMS КОМПАНИИ (STORY-089) — владельцу: кому, по какому поводу,
// что ушло и сколько стоило. Двести последних сообщений — больше в телефоне
// не читают; выгрузка, если понадобится, — отдельная просьба. Со страницы
// команды приходит `teamId` — тогда только её сообщения.

export function SmsHistoryScreen() {
  const t = useThemeColors();
  const { teamId } = useLocalSearchParams<{ teamId?: string }>();
  const { data: teams = [] } = useTeams();
  const team = teamId ? teams.find((x) => x.id === teamId) : undefined;
  const history = useSmsHistory(200, { teamId: teamId || null });
  const items = history.data ?? [];
  const pull = usePullRefresh(history.refetch);
  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="История SMS" subtitle={team?.name} />
      {history.isLoading ? (
        <EmptyState state="loading" fill />
      ) : history.isError ? (
        <EmptyState
          state="error"
          fill
          subtitle={history.error instanceof Error ? history.error.message : undefined}
          action={{ label: "Повторить", onPress: () => void history.refetch() }}
        />
      ) : items.length === 0 ? (
        <EmptyState fill title="Сообщений пока нет" subtitle="Здесь появятся SMS, отправленные через сервис." />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingVertical: 12, paddingHorizontal: GUTTER }}
          renderItem={({ item, index }) => (
            <View
              style={{
                backgroundColor: t.surface,
                borderTopLeftRadius: index === 0 ? t.radius.card : 0,
                borderTopRightRadius: index === 0 ? t.radius.card : 0,
                borderBottomLeftRadius: index === items.length - 1 ? t.radius.card : 0,
                borderBottomRightRadius: index === items.length - 1 ? t.radius.card : 0,
              }}
            >
              {index > 0 ? <Divider inset={16} /> : null}
              <SmsHistoryRow item={item} />
            </View>
          )}
          refreshing={pull.refreshing}
          onRefresh={pull.onRefresh}
        />
      )}
    </Screen>
  );
}

export default SmsHistoryScreen;
