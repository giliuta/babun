import { useMemo } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { useRouter } from "expo-router";
import { TEAM_COLORS } from "@babun/shared/local/masters";
import { RefListScreen } from "@/features/reference/RefListScreen";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import {
  useCreateTeam,
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
  const create = useCreateTeam();

  // Web parity: colour is mandatory from creation (teams/page.tsx picks
  // TEAM_COLORS[0]); default to the first palette colour not in use so
  // calendar chips stay distinguishable.
  const defaultColor = useMemo(() => {
    const used = new Set(teams.map((t) => t.color).filter(Boolean));
    return (
      TEAM_COLORS.find((c) => !used.has(c.value))?.value ?? TEAM_COLORS[0].value
    );
  }, [teams]);

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
      emptyText="Нет команд"
      addLabel="Добавить команду"
      fields={[
        { key: "name", label: "Название", placeholder: "Бригада 1", required: true },
        { key: "region", label: "Регион", placeholder: "Limassol" },
        {
          key: "color",
          label: "Цвет",
          type: "color",
          colors: TEAM_COLORS.map((c) => c.value),
          defaultValue: defaultColor,
          required: true,
        },
      ]}
      onCreate={async (v) => {
        const team = await create.mutateAsync({
          name: v.name,
          region: v.region,
          color: v.color,
        });
        // Цепочка «настроить новую команду»: счета строго per-brigade —
        // без счёта бригады не работает учёт денег. Предлагаем следующий
        // шаг сразу, с предвыбранной бригадой (2 тапа до готового счёта).
        Alert.alert(
          "Команда создана",
          `Создать счёт для «${team.name}»? Он нужен, чтобы вести деньги бригады.`,
          [
            {
              text: "Настроить команду",
              onPress: () => router.push(`/cabinet/teams/${team.id}`),
            },
            {
              text: "Создать счёт",
              onPress: () =>
                router.push({
                  pathname: "/accounts",
                  params: { create: "1", brigadeId: team.id },
                }),
            },
            { text: "Позже", style: "cancel" },
          ],
        );
      }}
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
