import { useRef } from "react";
import { Pressable, View } from "react-native";
import { Settings2 } from "lucide-react-native";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { ICON } from "@/components/ui/tokens";
import { parseYMD } from "@/features/appointments/helpers";
import {
  LabelPickerSheet,
  type LabelOption,
} from "@/features/reference/LabelPickerSheet";
import { useThemeColors } from "@/theme/colors";

// МЕТКА ДНЯ — ТОТ ЖЕ ЛИСТ ВЫБОРА МЕТКИ, ЧТО У ЗАПИСИ И У КЛИЕНТА
// (`features/reference/LabelPickerSheet`, сведено 2026-09-10). Здесь остаётся
// ровно то, что есть только у дня: дата в подзаголовке, тумблер «Выходной» и
// заморозка показанного на время анимации закрытия.
//
// ВЫХОДНОЙ НА ЭТОТ ДЕНЬ ЖИВЁТ ЗДЕСЬ ЖЕ (владелец 2026-08-17): «через метки
// можно было сразу поставить выходной только на этот день». Лист уже открылся
// тапом по числу и уже про ЭТОТ день — значит и «мы сегодня не работаем»
// спрашивается тут, а не на отдельной странице особых дней, куда за одним
// тумблером никто не пойдёт. Пишется date-override графика команды: только эта
// дата, недельный график не тронут.
//
// ШЕСТЕРЁНКА СПРАВА В ШАПКЕ (владелец 2026-08-24): «метка должна быть
// посередине, справа шестерёнка — знаешь, как ты делал в финансах, ползунки
// красивые». Тот же глиф `Settings2`, что в шапке счетов и в панелях финансов.

export type CityOption = LabelOption;

export function DayLabelSheet({
  visible,
  dateKey,
  options,
  selected,
  onPick,
  onClear,
  onClose,
  onSettings,
  dayOff,
  onToggleDayOff,
}: {
  visible: boolean;
  /** YYYY-MM-DD дня, чью метку меняем — подзаголовок шапки. */
  dateKey: string;
  options: readonly CityOption[];
  selected: string | null;
  onPick: (name: string) => void;
  onClear: () => void;
  onClose: () => void;
  /** Дверь в библиотеку меток. Нет — шестерёнки нет. */
  onSettings?: () => void;
  dayOff?: boolean;
  /** Без обработчика строки «Выходной» нет вовсе — так на личном календаре,
   *  где графика команды не существует. */
  onToggleDayOff?: (next: boolean) => void;
}) {
  const t = useThemeColors();

  // Заморозка на время анимации закрытия: родитель обнуляет дату сразу, а
  // лист уезжает ещё 240 мс — без заморозки подзаголовок прыгал на сегодня
  // и только что поставленная галочка гасла прямо на глазах.
  const lastShown = useRef({ dateKey, selected, dayOff: !!dayOff });
  if (visible) lastShown.current = { dateKey, selected, dayOff: !!dayOff };
  const shown = visible
    ? { dateKey, selected, dayOff: !!dayOff }
    : lastShown.current;

  const dateLabel = (() => {
    const s = parseYMD(shown.dateKey).toLocaleDateString("ru-RU", {
      weekday: "short",
      day: "numeric",
      month: "long",
    });
    return s.charAt(0).toUpperCase() + s.slice(1);
  })();

  return (
    <LabelPickerSheet
      visible={visible}
      title="Метка"
      // ВЫХОДНОЙ ПИШЕТСЯ НА МЕСТЕ МЕТКИ (владелец 2026-08-24): «когда
      // выбираешь выходной — там, где метка, пишется: чт, 27 число, и там
      // пишется выходной». Слово в подзаголовке — то же, что видно над датой
      // в календаре, и читается как метка дня.
      subtitle={shown.dayOff ? `${dateLabel} · Выходной` : dateLabel}
      options={options}
      value={shown.selected}
      onPick={onPick}
      onClear={onClear}
      onClose={onClose}
      onSettings={
        onSettings ? (
          <Pressable
            onPress={onSettings}
            accessibilityRole="button"
            accessibilityLabel="Настроить метки"
            className="h-11 w-11 items-center justify-center active:opacity-60"
          >
            <Settings2 color={t.sub} size={ICON.sm} strokeWidth={2} />
          </Pressable>
        ) : undefined
      }
      extra={
        // ОДНО СЛОВО БЕЗ ОБЪЯСНЕНИЙ (владелец 2026-08-24): «тумблер выходной,
        // слово только выходной, без каких-либо объяснений».
        onToggleDayOff ? (
          <View
            className="overflow-hidden"
            style={{ backgroundColor: t.surface, borderRadius: t.radius.card }}
          >
            <SwitchRow
              label="Выходной"
              value={shown.dayOff}
              onChange={onToggleDayOff}
            />
          </View>
        ) : undefined
      }
    />
  );
}
