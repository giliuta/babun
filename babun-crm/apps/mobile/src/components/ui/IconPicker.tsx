import { Pressable, Text, View } from "react-native";
import { useThemeColors } from "@/theme/colors";
import { ICON_PRESETS, type IconPreset } from "./icon-set";
import { PICKER_CELL, PICKER_COLUMNS } from "./picker-grid";

// Блок выбора ЗНАЧКА — брат-близнец `ColorPicker`: та же решётка в восемь
// столбцов, тот же шаг клетки (`picker-grid`), потому что в форме они стоят
// друг под другом и отвечают на один вопрос — «как узнать это в списке».
//
// Выбранное — заливка кружком в цвете сущности (`tint`), а не обводка: у
// значка внутри уже есть свои линии, и кольцо вокруг них превращается в кашу.
// Незанятые значки живут без подложки — сорок серых кружков читались бы как
// сорок кнопок.
const TILE = 32;
// Глиф 20 и полная громкость чернил: на 18pt в цвете `sub` ряд значков рядом с
// решёткой цветных точек читался бледной сноской, хотя это тот же по важности
// вопрос.
const GLYPH = 20;

export function IconPicker({
  value,
  onChange,
  label = "Значок",
  tint,
  icons,
  disabled,
}: {
  value: string | null | undefined;
  /** Слаг нажатого значка. Снятие выбора решает вызывающий: он знает `value`. */
  onChange: (slug: string) => void;
  /** Eyebrow above the grid; pass null to render none. */
  label?: string | null;
  /** Цвет заливки выбранного — по умолчанию акцент. */
  tint?: string | null;
  /** Набор-переопределение; по умолчанию общие сорок. */
  icons?: readonly IconPreset[];
  disabled?: boolean;
}) {
  const t = useThemeColors();
  const set = icons ?? ICON_PRESETS;
  const fill = tint ?? t.accent;

  return (
    <View className="mb-4">
      {label ? (
        <Text className="mb-2 text-xs font-medium" style={{ color: t.sub }}>
          {label}
        </Text>
      ) : null}
      <View className="flex-row flex-wrap">
        {set.map(({ value: slug, label: name, icon: Glyph }) => {
          const selected = value === slug;
          return (
            <Pressable
              key={slug}
              onPress={disabled ? undefined : () => onChange(slug)}
              disabled={disabled}
              hitSlop={3}
              accessibilityRole="button"
              accessibilityLabel={`Значок ${name}`}
              accessibilityState={{ selected, disabled: !!disabled }}
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
                  width: TILE,
                  height: TILE,
                  borderRadius: 999,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: selected ? fill : "transparent",
                }}
              >
                <Glyph
                  color={selected ? t.onAccent : t.body}
                  size={GLYPH}
                  strokeWidth={2}
                />
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
