import { Pressable, View } from "react-native";
import { Check } from "lucide-react-native";
import {
  PRESET_COLORS,
  type ColorPreset,
} from "@babun/shared/common/utils/colors";
import { readableTextOnColor } from "@/components/ui/color-contrast";
import { useThemeColors } from "@/theme/colors";
import { PICKER_COLUMNS, PICKER_GAP, PICKER_RADIUS } from "./picker-grid";

// «Halo Cobalt» colour picker — ОДИН блок выбора цвета на весь продукт
// (команды / метки / услуги / категории / типы событий / счета / теги / объекты).
// Палитра — общие PRESET_COLORS, сорок цветов, ни одной похожей пары.
//
// РЕШЁТКА КВАДРАТОВ (владелец 2026-09-10: «сделай не кругляшки, а квадратики…
// и плотнее, но чтобы разделитель был не волосина»; образцом показал Bumpix —
// сплошное поле плиток с галкой на выбранной). Было: сорок кружков 24pt в
// клетке 42pt, у каждого волосяная обводка, выбранное — кольцо своим цветом.
// Стало: плитка во всю клетку, между плитками зазор 6pt, выбранное — ГАЛКА
// внутри плитки, цветом, который читается на этой заливке.
//
// Почему галка, а не кольцо: кольцо своим же цветом на плотной решётке терялось
// среди соседей, а на бледной плитке пропадало вовсе. Галка стоит В цвете и
// читается на любом — её тон считает `readableTextOnColor`.

export function ColorPicker({
  value,
  onChange,
  colors,
  disabled,
}: {
  value: string | null | undefined;
  onChange: (hex: string) => void;
  /** Palette override (hex values) — defaults to the shared PRESET_COLORS. */
  colors?: readonly string[];
  disabled?: boolean;
}) {
  const t = useThemeColors();
  const palette: ColorPreset[] = colors
    ? colors.map(
        (v) =>
          PRESET_COLORS.find(
            (p) => p.value.toLowerCase() === v.toLowerCase(),
          ) ?? { name: v, value: v },
      )
    : [...PRESET_COLORS];

  // ЦВЕТ ИЗ ПРОШЛОГО ПОКАЗЫВАЕМ СВОЕЙ ПЛИТКОЙ. У тега, команды или услуги в базе
  // может лежать оттенок, которого в наборе нет: значение из старой палитры,
  // цвет из веб-мастера. Без этой плитки редактор открывался с ПУСТЫМ выбором,
  // хотя цвет у сущности есть и виден строкой выше, — человек читал это как
  // «цвет потерялся». Плитка стоит последней и означает ровно то, что есть:
  // свой цвет, вне набора.
  const own = (value ?? "").trim();
  if (
    /^#[0-9a-f]{6}$/i.test(own) &&
    !palette.some((p) => p.value.toLowerCase() === own.toLowerCase())
  ) {
    palette.push({ name: "свой", value: own });
  }

  return (
    // ЗАЗОР ДАЁТ КЛЕТКА, А НЕ `gap`. Клетка ровно 1/5 ширины и половина зазора
    // внутри неё полями: пять таких всегда встают в ряд без остатка, тогда как
    // `gap` съедает ширину сверх процентов и пятая плитка уезжает вниз.
    <View
      accessibilityRole="radiogroup"
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        marginHorizontal: -PICKER_GAP / 2,
      }}
    >
      {palette.map((c) => {
        // Reanimated's Babel check treats every `object.value` used inside an
        // inline style as a SharedValue, even though this is a plain colour
        // preset. Alias it before the style so development builds do not emit
        // one false warning for every swatch.
        const hex = c.value;
        const selected = (value ?? "").toLowerCase() === hex.toLowerCase();
        return (
          <Pressable
            key={hex}
            onPress={disabled ? undefined : () => onChange(hex)}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityLabel={`Цвет ${c.name}`}
            accessibilityState={{ selected, disabled: !!disabled }}
            // ШИРИНА КЛЕТКИ — ДОЛЕЙ, А НЕ ЧИСЛОМ: шторка на разных корпусах
            // разной ширины, а плитки обязаны заполнять ряд без остатка.
            style={({ pressed }) => ({
              width: `${100 / PICKER_COLUMNS}%`,
              aspectRatio: 1,
              padding: PICKER_GAP / 2,
              opacity: pressed ? 0.7 : disabled ? 0.4 : 1,
            })}
          >
            <View
              style={{
                flex: 1,
                borderRadius: PICKER_RADIUS,
                borderCurve: "continuous",
                backgroundColor: hex,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {selected ? (
                <Check
                  size={20}
                  strokeWidth={3}
                  color={readableTextOnColor(hex, t.ink, "#FFFFFF")}
                />
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
