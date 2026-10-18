import { Pressable, View } from "react-native";
import Animated, {
  interpolateColor,
  useDerivedValue,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";
import { countWordRu } from "@babun/shared/common/utils/pluralize";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import { CLIENT_NOUN, INK, type Noun3 } from "./constants";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Оттиск-ряд попапа: мультивыбор БЕЗ галки — выбранный ряд печатается
 *  сплошным ink с белой подписью (крашфейд 140мс). В слоте хинта —
 *  контекстный счётчик; ряд с нулём пригашен и неактивен. */
export function PickRow({
  label,
  rule,
  active,
  separated,
  tick,
  count,
  reduced,
  noun = CLIENT_NOUN,
  onToggle,
}: {
  label: string;
  /** Что считается: «клиент» здесь, «изменение» в истории. */
  noun?: Noun3;
  /** Правило ряда одним предложением. Без него «Постоянные» не говорит,
   *  сколько это визитов, и статусу невозможно верить. */
  rule?: string;
  active: boolean;
  /** Волосок к соседу сверху (внутри блока). */
  separated: boolean;
  tick?: string;
  count: number;
  reduced: boolean;
  onToggle: () => void;
}) {
  const t = useThemeColors();
  const dimmed = count === 0 && !active;
  const progress = useDerivedValue(
    () => withTiming(active ? 1 : 0, { duration: reduced ? 0 : 140 }),
    [active, reduced],
  );
  const bgStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      ["rgba(11,18,32,0)", INK],
    ),
  }));
  const labelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(
      progress.value,
      [0, 1],
      [dimmed ? "rgba(11,18,32,0.32)" : INK, "#FFFFFF"],
    ),
  }));
  const hintStyle = useAnimatedStyle(() => ({
    // В мёртвом ряду ноль не должен звучать громче имени.
    color: interpolateColor(
      progress.value,
      [0, 1],
      [dimmed ? "rgba(11,18,32,0.28)" : t.faint, "rgba(255,255,255,0.64)"],
    ),
  }));
  const tickStyle = useAnimatedStyle(() => ({
    opacity: dimmed ? 0.25 : 0.45 + progress.value * 0.55,
  }));
  return (
    <AnimatedPressable
      onPress={() => {
        haptics.tap();
        onToggle();
      }}
      disabled={dimmed}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: active, disabled: dimmed }}
      accessibilityLabel={
        dimmed
          ? `${label}, нет ${noun[2]} при текущих условиях`
          : `${label}, ${count} ${countWordRu(count, ...noun)}`
      }
      accessibilityHint={
        dimmed ? undefined : "Добавляет к набору, список останется открытым"
      }
      // 0.70 сереет чернила оттиска — берём мягче.
      className="flex-row items-center active:opacity-90"
      style={[
        {
          minHeight: 48,
          paddingVertical: rule ? 8 : 0,
          paddingHorizontal: 16,
          borderTopWidth: separated ? 1 : 0,
          borderTopColor: t.separator,
        },
        bgStyle,
      ]}
    >
      {tick ? (
        <Animated.View
          style={[
            {
              width: 2,
              height: 16,
              borderRadius: 1,
              marginRight: 10,
              backgroundColor: tick,
            },
            tickStyle,
          ]}
        />
      ) : null}
      {/* Вес подписи постоянный: на тапе менялся 500→600 и строка
          внезапно обзаводилась многоточием. */}
      <View style={{ flexShrink: 1 }}>
        <Animated.Text
          maxFontSizeMultiplier={1.3}
          numberOfLines={1}
          style={[{ fontSize: 15, fontWeight: "600" }, labelStyle]}
        >
          {label}
        </Animated.Text>
        {rule ? (
          <Animated.Text
            maxFontSizeMultiplier={1.3}
            numberOfLines={2}
            style={[{ fontSize: 13, marginTop: 1 }, hintStyle]}
          >
            {rule}
          </Animated.Text>
        ) : null}
      </View>
      <Animated.Text
        maxFontSizeMultiplier={1.3}
        style={[
          {
            marginLeft: "auto",
            paddingLeft: 12,
            fontSize: 13,
            fontVariant: ["tabular-nums"],
          },
          hintStyle,
        ]}
      >
        {count}
      </Animated.Text>
    </AnimatedPressable>
  );
}
