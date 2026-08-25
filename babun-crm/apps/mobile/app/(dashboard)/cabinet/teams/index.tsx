import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { useRouter } from "expo-router";
import { PRESET_COLOR_CYCLE } from "@babun/shared/common/utils/colors";
import { RefListScreen } from "@/features/reference/RefListScreen";
import { ICON } from "@/components/ui/tokens";
import { useToast } from "@/components/ui/Toast";
import { useCreateTeamAccounts } from "@/features/finances/accounts";
import { useThemeColors } from "@/theme/colors";
import {
  useCreateTeam,
  useTeams,
  type Team,
} from "@/features/reference/queries";

export default function TeamsScreen() {
  const th = useThemeColors();
  const router = useRouter();
  const toast = useToast();
  const seedAccounts = useCreateTeamAccounts();
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

  // Web parity: colour is mandatory from creation; default to the first
  // colour of the working thirteen not in use, so calendar chips stay
  // distinguishable. Автомат берёт сочное (`PRESET_COLOR_CYCLE`), а не первую
  // клетку решётки из сорока — иначе первая команда рождается вишнёвой.
  const defaultColor = useMemo(() => {
    const used = new Set(teams.map((t) => t.color).filter(Boolean));
    return (
      PRESET_COLOR_CYCLE.find((c) => !used.has(c.value))?.value ??
      PRESET_COLOR_CYCLE[0].value
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
        { key: "name", label: "Название", placeholder: "Команда 1", required: true },
        { key: "region", label: "Регион", placeholder: "Limassol" },
        {
          key: "color",
          label: "Цвет",
          type: "color",
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
        // СЧЕТА ЗАВОДЯТСЯ САМИ (ТЗ §5.1). Команда без счёта не может принять
        // деньги вообще — это поломка, а не выбор, поэтому вопроса больше
        // нет: «Наличные» и «Карта» создаются молча, а тост говорит, что
        // именно появилось, и даёт дверь, если имена или вид не подошли.
        try {
          const created = await seedAccounts.mutateAsync(team.id);
          if (created.length > 0) {
            toast(
              `Команде «${team.name}» созданы счета: ${created
                .map((account) => account.name)
                .join(", ")}`,
              "success",
              // «Изменить» ведёт на счета ИМЕННО ЭТОЙ команды: без параметра
              // экран открывался на первом чипе, и человек смотрел на счета
              // чужой команды сразу после слов «команде созданы счета».
              {
                label: "Изменить",
                onPress: () => router.push(`/accounts?team=${team.id}`),
              },
            );
          }
        } catch (e) {
          // Команда уже создана — молчать нельзя, но и держать человека в
          // форме незачем: счета дозаводятся из «Настроек счетов».
          toast(
            `Команда создана, но счета не завелись: ${
              e instanceof Error ? e.message : "попробуйте ещё раз"
            }`,
            "error",
          );
        }
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
