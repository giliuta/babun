import { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { CalendarRange } from "lucide-react-native";
import { GradientButton } from "@/components/ui/GradientButton";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SelectList, SelectRow } from "@/components/ui/select-rows";
import { useToast } from "@/components/ui/Toast";
import { GUTTER } from "@/components/ui/tokens";
import { useTeams } from "@/features/reference/queries";
import { notify } from "@/lib/notify";
import { TIER_LIMITS, tierName, workingTeamIds } from "./tiers";
import { useChooseWorkingTeams, useTariff } from "./use-tariff";

// КАБИНЕТ → ТАРИФ → РАБОЧИЕ КОМАНДЫ (владелец 01.10: «после Макса с
// множеством команд — выбрать 5 рабочих, остальные не могут добавлять
// клиентов»). Команд больше, чем даёт тариф: владелец отмечает, какие
// работают; остальные только смотрят — новых клиентов и записей в них нет.
// Правило то же, что `team_is_working` на сервере.

export function WorkingTeamsScreen() {
  const router = useRouter();
  const toast = useToast();
  const { state, workingChosen } = useTariff();
  const { data: teams = [] } = useTeams();
  const choose = useChooseWorkingTeams();
  const live = useMemo(() => teams.filter((team) => team.is_active !== false), [teams]);
  const limit = state.tier ? TIER_LIMITS[state.tier].teams : live.length;
  const initial = useMemo(
    () => [...workingTeamIds(live, state.tier, workingChosen)],
    [live, state.tier, workingChosen],
  );
  const [picked, setPicked] = useState<string[] | null>(null);
  const chosen = picked ?? initial;
  const changed =
    picked != null &&
    (picked.length !== initial.length || picked.some((id) => !initial.includes(id)));

  const toggle = (id: string) => {
    if (chosen.includes(id)) {
      setPicked(chosen.filter((item) => item !== id));
      return;
    }
    if (chosen.length >= limit) {
      toast(`В тарифе «${state.tier ? tierName(state.tier) : ""}» работают до ${limit}`, "info");
      return;
    }
    setPicked([...chosen, id]);
  };

  const save = async () => {
    try {
      await choose.mutateAsync(chosen);
      router.back();
    } catch (e) {
      notify("Не сохранилось", e instanceof Error ? e.message : undefined);
    }
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Рабочие команды" subtitle={`${chosen.length} из ${limit}`} />
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 24 }}>
        {/* Строка команды — та же, что в выборе календарей партнёра
            (`CalendarPickerSheet`): значок, цвет команды, галка. */}
        <View style={{ paddingTop: 8 }}>
          <SelectList>
            {live.map((team) => (
              <SelectRow
                key={team.id}
                icon={CalendarRange}
                title={team.name}
                color={team.color ?? undefined}
                selected={chosen.includes(team.id)}
                subtitle={chosen.includes(team.id) ? "Работает" : "Только смотрит"}
                accessibilityRole="checkbox"
                onPress={() => toggle(team.id)}
              />
            ))}
          </SelectList>
        </View>
      </ScrollView>
      <View style={{ paddingHorizontal: GUTTER, paddingTop: 8, paddingBottom: 16 }}>
        <GradientButton
          label="Сохранить"
          disabled={!changed || chosen.length === 0}
          loading={choose.isPending}
          onDisabledPress={() =>
            toast(chosen.length === 0 ? "Отметьте хотя бы одну команду" : "Ничего не изменилось", "info")
          }
          onPress={() => void save()}
        />
      </View>
    </Screen>
  );
}

export default WorkingTeamsScreen;
