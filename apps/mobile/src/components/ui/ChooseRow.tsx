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
  compact,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string;
  /** ПЛОТНЫЙ СЛУЧАЙ — ФОРМА В ШТОРКЕ (владелец 2026-09-10: «сделай все эти
   *  блоки компактнее»). На странице записи у строки есть куда дышать: она
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
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      style={({ pressed }) => ({ backgroundColor: pressed ? t.pressed : "transparent" })}
    >
      <IconCircle icon={icon} size={compact ? 30 : 34} />
      <Text className="flex-1" style={{ marginLeft: 12, fontSize: 17, fontWeight: "600", color: t.accent }}>
        {label}
      </Text>
      <ChevronRight color={t.chevron} size={ICON.sm} />
    </Pressable>
  );
}
