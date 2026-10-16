import { Text, View } from "react-native";
import { useThemeColors } from "@/theme/colors";

/**
 * СТРОКА РАЗБОРА — имя, «×N», сумма справа и полоска доли под ними. Одна
 * вёрстка на «Прибыль» «Финансов» и на панели «Аналитики» — без новой с нуля.
 */
export function BreakdownBarRow({
  name,
  count,
  value,
  color,
  share,
  note,
  delta,
}: {
  name: string;
  /** «×N» после имени; ноль — без счётчика. */
  count: number;
  value: string;
  /** Цвет суммы и полоски — цвет смысла строки. */
  color: string;
  /** Доля 0…1; вне отрезка прижимается. */
  share: number;
  /** Тихая подпись после имени — «было €593», «материалы €40». */
  note?: string;
  /** Изменение перед суммой — «↑ 23%» цветом смысла (рост или падение). */
  delta?: { text: string; color: string };
}) {
  const th = useThemeColors();
  const pct = Math.min(100, Math.max(0, share * 100));
  return (
    <View className="px-4 py-2.5">
      <View className="flex-row items-center">
        <Text
          className="shrink text-[15px]"
          style={{ color: th.ink }}
          numberOfLines={1}
        >
          {name}
        </Text>
        {count > 0 ? (
          <Text className="ml-1.5 text-xs" style={{ color: th.faint }}>
            ×{count}
          </Text>
        ) : null}
        {note ? (
          <Text
            className="ml-1.5 shrink text-xs"
            numberOfLines={1}
            style={{ color: th.faint, fontVariant: ["tabular-nums"] }}
          >
            {note}
          </Text>
        ) : null}
        {delta ? (
          <Text
            className="ml-auto pl-2.5 text-[13px] font-semibold"
            style={{ fontVariant: ["tabular-nums"], color: delta.color }}
          >
            {delta.text}
          </Text>
        ) : null}
        <Text
          className={`${delta ? "ml-2.5" : "ml-auto pl-2.5"} text-[15px] font-semibold`}
          style={{ fontVariant: ["tabular-nums"], color }}
        >
          {value}
        </Text>
      </View>
      <View
        className="mt-1.5 h-1.5 overflow-hidden rounded-full"
        style={{ backgroundColor: th.separator }}
      >
        <View
          className="h-1.5 rounded-full"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </View>
    </View>
  );
}

/** Шапка секции разбора — «ЧТО ПРИНЕСЛО ДЕНЕГ · €728». Одна на «Прибыль» и
 *  секции «Аналитики»: капс слева, итог секции её цветом справа. */
export function BreakdownSectionHeader({
  title,
  value,
  color,
}: {
  title: string;
  value?: string;
  color?: string;
}) {
  const th = useThemeColors();
  return (
    <View className="flex-row items-baseline px-4 pb-1 pt-3">
      <Text
        className="text-xs font-semibold uppercase tracking-wider"
        style={{ color: th.sub }}
      >
        {title}
      </Text>
      {value ? (
        <Text
          className="ml-auto text-[13px] font-bold"
          style={{ fontVariant: ["tabular-nums"], color: color ?? th.ink }}
        >
          {value}
        </Text>
      ) : null}
    </View>
  );
}
