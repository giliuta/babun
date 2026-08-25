import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  PRESET_COLORS,
  type ColorPreset,
} from "@babun/shared/common/utils/colors";
import { useThemeColors } from "@/theme/colors";
import { PICKER_CELL, PICKER_COLUMNS } from "./picker-grid";

// «Halo Cobalt» colour picker — ОДИН блок выбора цвета на весь продукт
// (команды / метки / услуги / категории услуг / типы событий / категории
// финансов / счета / теги клиентов). Палитра — общие PRESET_COLORS, 40 цветов.
//
// РЕШЁТКА, А НЕ ГРЯДКА КРУЖКОВ (владелец 2026-08-17: «не такие большие кружки,
// это выглядит немного ужасно»). Было тринадцать подушек по 44pt, которые
// переносились как попало и занимали пол-формы. Стало:
//   • точка 24pt в клетке 12.5% ширины — ровно ВОСЕМЬ в ряду, пять рядов;
//   • столбец = семейство оттенка, ряд = громкость (порядок задан палитрой),
//     поэтому глаз идёт по двум осям, а не перебирает сорок точек;
//   • выбранное = КОЛЬЦО своим же цветом, размер точки не меняется — решётка
//     не дёргается при выборе, и это единственный способ отличить выбранное
//     на бледном ряде, где галочка тонет;
//   • волосяная обводка у точки: без неё мягкий ряд теряется на белой карточке.
// Цель нажатия остаётся не меньше 44pt (клетка 38 + hitSlop 3 по кругу).
const DOT = 24;
const RING = 32;

export function ColorPicker({
  value,
  onChange,
  label = "Цвет",
  colors,
  disabled,
}: {
  value: string | null | undefined;
  onChange: (hex: string) => void;
  /** Eyebrow above the swatches; pass null to render none. */
  label?: string | null;
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

  // ЦВЕТ ИЗ ПРОШЛОГО ПОКАЗЫВАЕМ СВОЕЙ ТОЧКОЙ. У тега, команды или услуги в базе
  // может лежать оттенок, которого в наборе нет: убранный «Красный» #FF3B30,
  // цвет из веб-мастера, значение из старой палитры. Без этой точки редактор
  // открывался с ПУСТЫМ выбором, хотя цвет у сущности есть и виден строкой
  // выше, — человек читал это как «цвет потерялся». Ряд из одной точки под
  // решёткой и означает ровно то, что есть: свой цвет, вне набора. Стоит до
  // первого выбора из палитры.
  const own = (value ?? "").trim();
  if (
    /^#[0-9a-f]{6}$/i.test(own) &&
    !palette.some((p) => p.value.toLowerCase() === own.toLowerCase())
  ) {
    palette.push({ name: "свой", value: own });
  }

  return (
    <View className="mb-4">
      {label ? (
        <Text className="mb-2 text-xs font-medium" style={{ color: t.sub }}>
          {label}
        </Text>
      ) : null}
      <View className="flex-row flex-wrap" accessibilityRole="radiogroup">
        {palette.map((c) => {
          // Reanimated's Babel check treats every `object.value` used inside
          // an inline style as a SharedValue, even though this is a plain
          // colour preset. Alias it before the style so development builds
          // do not emit one false warning for every swatch.
          const hex = c.value;
          const selected = (value ?? "").toLowerCase() === hex.toLowerCase();
          return (
            <Pressable
              key={hex}
              onPress={disabled ? undefined : () => onChange(hex)}
              disabled={disabled}
              hitSlop={3}
              accessibilityRole="radio"
              accessibilityLabel={`Цвет ${c.name}`}
              accessibilityState={{ selected, disabled: !!disabled }}
              // РАСКЛАДКУ ДЕРЖИМ ЧИСЛАМИ: доли `w-1/8` в NativeWind нет, а
              // ширина клетки обязана быть точной — иначе восьмой цвет уезжает
              // на следующую строку и решётка рассыпается.
              style={({ pressed }) => ({
                width: `${100 / PICKER_COLUMNS}%`,
                height: PICKER_CELL,
                alignItems: "center",
                justifyContent: "center",
                opacity: pressed ? 0.6 : disabled ? 0.4 : 1,
              })}
            >
              <View
                style={{
                  width: RING,
                  height: RING,
                  borderRadius: 999,
                  borderWidth: 2,
                  borderColor: selected ? hex : "transparent",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <View
                  style={{
                    width: DOT,
                    height: DOT,
                    borderRadius: 999,
                    backgroundColor: hex,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: t.separator,
                  }}
                />
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
