import {
  useCalendarSettings,
  useSaveCalendarSettings,
} from "@/features/settings/local-settings";
import { useRenameDayCity } from "@/features/calendar/day-cities";

// КАСКАД ПЕРЕИМЕНОВАНИЯ МЕТКИ. Имя хранится СТРОКОЙ (не id) в днях
// (`day_cities.city`) и в личных метках веба, поэтому переименование в
// справочнике надо разнести по этим местам — иначе метки осиротеют
// (аудит кабинета P1-12).
//
// СУЗИЛСЯ ДВАЖДЫ 29 августа, когда метка стала собственностью команды:
//   • `teams.cities` больше не правится — этот список был ПОДБОРОМ имён из
//     общего справочника, а с владением он рудимент;
//   • клиенты не трогаются вовсе: своей команды у клиента нет, а по закону
//     канона «прошлое не переписывается настройкой» его метка — отметка
//     «где обслуживали тогда», и старое имя в карточке это правда о прошлом.
//
// Частичные сбои не бросают: возвращается список мест, которые не
// обновились, — экран показывает один алерт.
export function useRenameLabelCascade() {
  const renameDays = useRenameDayCity();
  const { data: settings } = useCalendarSettings();
  const saveSettings = useSaveCalendarSettings();

  const run = async (
    teamId: string,
    oldName: string,
    newName: string,
  ): Promise<string[]> => {
    if (oldName === newName) return [];
    const failures: string[] = [];
    // `teams.cities` каскад больше не правит: этот список был ПОДБОРОМ имён
    // из общего справочника, а с владением (`cities.team_id`) он рудимент —
    // метки команды и есть её строки в справочнике.
    try {
      await renameDays.mutateAsync({ teamId, from: oldName, to: newName });
    } catch {
      failures.push("метки дней");
    }
    // МЕТКИ КЛИЕНТОВ ПЕРЕИМЕНОВАНИЕ НЕ ТРОГАЕТ (2026-08-29).
    //
    // Раньше здесь шёл batch-update `clients.city` по имени на весь тенант.
    // С тех пор как метка принадлежит команде, это стало утечкой: правка
    // «Лимассола» у своей бригады переписала бы клиентов всех остальных —
    // одноимённые метки разных календарей теперь РАЗНЫЕ метки.
    //
    // Ограничить его командой нечем: своего поля команды у клиента нет, она
    // выводится из записей. Но чинить и не надо — по закону канона от
    // 2026-08-29 «прошлое не переписывается настройкой»: метка клиента это
    // отметка «где его обслуживали тогда», и переименование справочника её
    // трогать не должно. Старое имя в карточке — правда о прошлом.
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
      renameDays.isPending || saveSettings.isPending,
  };
}
