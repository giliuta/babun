import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { useRouter } from "expo-router";
import { RefListScreen } from "@/features/reference/RefListScreen";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import {
  useTeams,
  type Team,
} from "@/features/reference/queries";

export default function TeamsScreen() {
  const th = useThemeColors();
  const router = useRouter();
  // Включая архивные: иначе архивация — билет в один конец (веб показывает
  // архив, аудит P1-10). Активные сверху, архив серым хвостом.
  const { data: allTeams = [], isLoading, isError, error, refetch } = useTeams({
    includeInactive: true,
  });
  const teams = useMemo(
    () => [
      ...allTeams.filter((t) => t.is_active),
      ...allTeams.filter((t) => !t.is_active),
    ],
    [allTeams],
  );


  // v-hubs: a team row is now a NAV row to the brigade hub (teams/[id]),
  // not an inline editor. Name / colour / active / delete all moved into
  // the hub (web parity: teams/[id]/page.tsx). So we deliberately omit
  // itemToValues/onUpdate/onDelete — RefListScreen then renders our row
  // as-is and we own the Pressable → push.
  return (
    <RefListScreen<Team>
      title="Команды"
      items={teams}
      isLoading={isLoading}
      error={isError ? error : undefined}
      onRetry={() => void refetch()}
      emptyText="Календари создаются в настройках календаря"
      renderItem={(item) => (
        <Pressable
          onPress={() => router.push(`/cabinet/teams/${item.id}`)}
          accessibilityRole="button"
          accessibilityLabel={`Команда ${item.name}${item.is_active ? "" : ", в архиве"}`}
          className="flex-row items-center px-4 py-3 active:opacity-60"
        >
          <View
            className="mr-3 h-4 w-4 rounded-full"
            style={{
              backgroundColor: item.is_active
                ? item.color ?? th.faint
                : th.faint,
            }}
          />
          <View className="flex-1">
            <Text
              style={{
                fontSize: 16,
                fontWeight: "600",
                color: item.is_active ? th.ink : th.faint,
              }}
            >
              {item.name}
            </Text>
            {!item.is_active ? (
              <Text style={{ fontSize: 14, color: th.faint }}>
                В архиве — открыть, чтобы вернуть
              </Text>
            ) : item.region ? (
              <Text style={{ fontSize: 14, color: th.sub }}>{item.region}</Text>
            ) : null}
          </View>
          <ChevronRight color={th.chevron} size={ICON.sm} />
        </Pressable>
      )}
    />
  );
}
