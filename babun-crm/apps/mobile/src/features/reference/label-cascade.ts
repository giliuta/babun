import {
  useCalendarSettings,
  useSaveCalendarSettings,
} from "@/features/settings/local-settings";
import { useRenameDayCity } from "@/features/calendar/day-cities";
import { teamCities, useTeams, useUpdateTeam } from "./queries";

// Каскад переименования метки/города по всем местам, где имя хранится
// СТРОКОЙ (не id): team.cities[] + default_city, day_cities, и
// personalLabels веба. Без каскада переименование в библиотеке (cities)
// тихо осиротит метки команд и дней — аудит кабинета P1-12.
//
// Используют «Метки» (labels.tsx) и «Города» (cities.tsx) — оба экрана
// правят одну таблицу. Частичные сбои не бросают: возвращается список
// мест, которые не обновились, — экран показывает один алерт.
export function useRenameLabelCascade() {
  // Все команды, включая архивные: у них тоже есть cities/default_city,
  // и после разархивации метки должны остаться живыми.
  const { data: teams = [] } = useTeams({ includeInactive: true });
  const updateTeam = useUpdateTeam();
  const renameDays = useRenameDayCity();
  const { data: settings } = useCalendarSettings();
  const saveSettings = useSaveCalendarSettings();

  const run = async (oldName: string, newName: string): Promise<string[]> => {
    if (oldName === newName) return [];
    const failures: string[] = [];
    for (const team of teams) {
      const list = teamCities(team);
      const usesList = list.includes(oldName);
      const usesDefault = team.default_city === oldName;
      if (!usesList && !usesDefault) continue;
      const patch: Record<string, unknown> = {};
      if (usesList) {
        patch.cities = list.map((n) => (n === oldName ? newName : n));
      }
      if (usesDefault) patch.default_city = newName;
      try {
        await updateTeam.mutateAsync({ id: team.id, patch });
      } catch {
        failures.push(`команда «${team.name}»`);
      }
    }
    try {
      await renameDays.mutateAsync({ from: oldName, to: newName });
    } catch {
      failures.push("метки дней");
    }
    const personal = settings?.personalLabels ?? [];
    if (personal.includes(oldName)) {
      try {
        await saveSettings.mutateAsync({
          personalLabels: personal.map((n) => (n === oldName ? newName : n)),
          personalDefaultLabel:
            settings?.personalDefaultLabel === oldName
              ? newName
              : settings?.personalDefaultLabel,
        });
      } catch {
        failures.push("личные метки веба");
      }
    }
    return failures;
  };

  return {
    run,
    pending:
      updateTeam.isPending || renameDays.isPending || saveSettings.isPending,
  };
}
