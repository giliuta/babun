import { Pressable, Text } from "react-native";
import { ChevronRight, type LucideIcon } from "lucide-react-native";
import { IconCircle } from "./IconCircle";
import { ICON } from "./tokens";
import { useThemeColors } from "@/theme/colors";

// СТРОКА «ВЫБРАТЬ …» — ОДНА НА КЛИЕНТА, ОБЪЕКТ И УСЛУГУ (аудит страницы записи
// 2026-09-06). Три пустых состояния формы отвечали на один вопрос «кого /
// куда / что» тремя вёрстками: у клиента и объекта — кружок со значком и
// шеврон, у услуги — голая строка «+ Добавить». Теперь дверь к выбору
// выглядит одинаково: кружок со значком предмета, надпись акцентом, шеврон.
// «Добавить …» (AddRow) остаётся у ДОБАВЛЕНИЯ нового — файлов, объекта.

export function ChooseRow({
  icon,
  label,
  hint,
  disabled,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string;
  /** ДВЕРЬ ЕЩЁ ЗАКРЫТА, НО СТОИТ НА МЕСТЕ (владелец 2026-09-08: «просто там
   *  написано „добавить объект“, он выделен серым до тех пор, пока не выбран
   *  клиент; как только выбрал — становится с серого на голубой»). Раньше на
   *  этом месте стояла фраза «Сначала выберите клиента»: строка меняла и
   *  вид, и высоту, и блок прыгал под пальцем. */
  disabled?: boolean;
  onPress: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      className="flex-row items-center px-4 py-3.5"
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
      <IconCircle icon={icon} muted={disabled} />
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
