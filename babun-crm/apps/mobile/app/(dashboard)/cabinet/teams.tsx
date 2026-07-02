import { useMemo } from "react";
import { Text, View } from "react-native";
import { TEAM_COLORS } from "@babun/shared/local/masters";
import { RefListScreen } from "@/features/reference/RefListScreen";
import { useThemeColors } from "@/theme/colors";
import {
  useCreateTeam,
  useDeleteTeam,
  useTeams,
  useUpdateTeam,
  type Team,
} from "@/features/reference/queries";

export default function TeamsScreen() {
  const th = useThemeColors();
  const { data: teams = [], isLoading } = useTeams();
  const create = useCreateTeam();
  const update = useUpdateTeam();
  const del = useDeleteTeam();

  // Web parity: colour is mandatory from creation (teams/page.tsx picks
  // TEAM_COLORS[0]); default to the first palette colour not in use so
  // calendar chips stay distinguishable.
  const defaultColor = useMemo(() => {
    const used = new Set(teams.map((t) => t.color).filter(Boolean));
    return (
      TEAM_COLORS.find((c) => !used.has(c.value))?.value ?? TEAM_COLORS[0].value
    );
  }, [teams]);

  return (
    <RefListScreen<Team>
      title="Команды"
      items={teams}
      isLoading={isLoading}
      emptyText="Нет команд — добавьте первую через +"
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
        await create.mutateAsync({ name: v.name, region: v.region, color: v.color });
      }}
      onUpdate={async (id, v) => {
        await update.mutateAsync({
          id,
          patch: { name: v.name, region: v.region || null, color: v.color },
        });
      }}
      onDelete={async (id) => {
        await del.mutateAsync(id);
      }}
      itemToValues={(t) => ({
        name: t.name,
        region: t.region ?? "",
        color: t.color ?? "",
      })}
      renderItem={(item) => (
        <View className="flex-row items-center px-4 py-3">
          <View
            className="mr-3 h-4 w-4 rounded-full"
            style={{ backgroundColor: item.color ?? th.faint }}
          />
          <View className="flex-1">
            <Text style={{ fontSize: 16, fontWeight: "600", color: th.ink }}>{item.name}</Text>
            {item.region ? (
              <Text style={{ fontSize: 14, color: th.sub }}>{item.region}</Text>
            ) : null}
          </View>
        </View>
      )}
    />
  );
}
