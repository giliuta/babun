import { Pressable, Text } from "react-native";
import { ChevronRight, type LucideIcon } from "lucide-react-native";
import { IconCircle } from "./IconCircle";
import { ICON } from "./tokens";
import { useThemeColors } from "@/theme/colors";

// СТРОКА «ВЫБРАТЬ …» — ОДНА НА КЛИЕНТА, ОБЪЕКТ И УСЛУГУ.
// Три пустых состояния формы отвечают на один вопрос «кого / куда / что», и
// вёрстка у них одна: дверь к выбору выглядит одинаково — кружок со значком
// предмета, надпись акцентом, шеврон (не голая строка «+ Добавить», как было
// бы у услуги).
// На карточке клиента ею же сделаны и двери добавления — «Добавить
// контакт / человека / объект / файл / реквизиты»: голых «Добавить» там нет.

export function ChooseRow({
  icon,
  label,
  hint,
  disabled,
  compact,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string;
  /** ДВЕРЬ ЕЩЁ ЗАКРЫТА, НО СТОИТ НА МЕСТЕ: «добавить объект» серым, пока не
   *  выбран клиент, и голубым, как только выбран. Фраза «Сначала выберите
   *  клиента» на этом месте меняла бы и вид, и высоту строки, и блок прыгал
   *  бы под пальцем. */
  disabled?: boolean;
  /** ПЛОТНЫЙ СЛУЧАЙ — ФОРМА В ШТОРКЕ.
   *  На странице записи у строки есть куда дышать: она
   *  занимает экран целиком. В шторке блоков шесть, и те же 62 точки на
   *  каждую пустую строку съедают треть листа. Устройство строки то же —
   *  кружок, слово, шеврон, — тише только воздух. */
  compact?: boolean;
  onPress: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      className={`flex-row items-center px-4 ${compact ? "py-2" : "py-3.5"}`}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => ({
        backgroundColor: pressed && !disabled ? t.pressed : "transparent",
      })}
    >
      <IconCircle icon={icon} muted={disabled} size={compact ? 30 : 34} />
      <Text
        className="flex-1"
        style={{
          marginLeft: 12,
          fontSize: 17,
          fontWeight: "600",
          color: disabled ? t.faint : t.accent,
        }}
      >
        {label}
      </Text>
      {disabled ? null : <ChevronRight color={t.chevron} size={ICON.sm} />}
    </Pressable>
  );
}
