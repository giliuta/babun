import { BellOff, CalendarDays, CalendarRange, Sunrise } from "lucide-react-native";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { ymdInDays } from "@/features/clients/format";
import { useThemeColors } from "@/theme/colors";

// «НАПОМНИТЬ О КЛИЕНТЕ» — один лист на весь продукт.
//
// Раньше это же действие рисовалось ДВУМЯ разными окнами: на карточке —
// системный выбор без значков, в списке (long-press) — системный `Alert`.
// Одно действие обязано выглядеть одинаково, откуда бы его ни позвали.
//
// Пресеты те же, что были у кнопки «Напомнить» до её переезда в меню:
// завтра · через неделю · через месяц.

export function RemindSheet({
  visible,
  clientName,
  hasReminder,
  onPick,
  onClose,
}: {
  visible: boolean;
  /** Имя в заголовке: лист может открыться из списка, где клиентов много. */
  clientName?: string | null;
  /** Есть что убирать — показываем «Убрать напоминание». */
  hasReminder: boolean;
  /** null — снять напоминание. */
  onPick: (reminderAt: string | null) => void;
  onClose: () => void;
}) {
  const t = useThemeColors();
  return (
    <PickerSheet
      visible={visible}
      title={clientName?.trim() || "Напомнить о клиенте"}
      items={[
        {
          id: "tomorrow",
          label: "Завтра",
          icon: Sunrise,
          color: t.accent,
          onPress: () => onPick(ymdInDays(1)),
        },
        {
          id: "week",
          label: "Через неделю",
          icon: CalendarDays,
          color: t.accent,
          onPress: () => onPick(ymdInDays(7)),
        },
        {
          id: "month",
          label: "Через месяц",
          icon: CalendarRange,
          color: t.accent,
          onPress: () => onPick(ymdInDays(30)),
        },
        ...(hasReminder
          ? [
              {
                id: "clear",
                label: "Убрать напоминание",
                icon: BellOff,
                color: t.danger,
                onPress: () => onPick(null),
              },
            ]
          : []),
      ]}
      onClose={onClose}
    />
  );
}

export default RemindSheet;
