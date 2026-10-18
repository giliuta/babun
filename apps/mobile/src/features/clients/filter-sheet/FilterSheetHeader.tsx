import { Pressable, Text, View } from "react-native";
import { useThemeColors } from "@/theme/colors";
import { SLOT } from "./constants";

/** Шапка листа «Фильтры»: заголовок по центру, «Сбросить / Вернуть»
 *  справа и сводка набора под ними. */
export function FilterSheetHeader({
  nothingActive,
  undo,
  activeSummary,
  onReset,
}: {
  nothingActive: boolean;
  undo: boolean;
  activeSummary: string | null;
  onReset: () => void;
}) {
  const t = useThemeColors();
  return (
    <>
      {/* Шапка 92│центр│92 — «Фильтры» оптически по центру всегда. */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          minHeight: 38,
          paddingHorizontal: 20,
          paddingTop: 2,
        }}
      >
        <View style={{ width: SLOT }} />
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text
            accessibilityRole="header"
            maxFontSizeMultiplier={1.2}
            numberOfLines={1}
            style={{ fontSize: 17, fontWeight: "600", color: t.ink }}
          >
            Фильтры
          </Text>
        </View>
        <View style={{ width: SLOT, alignItems: "flex-end" }}>
          <Pressable
            onPress={onReset}
            disabled={nothingActive && !undo}
            accessibilityRole="button"
            accessibilityLabel={undo ? "Вернуть фильтры" : "Сбросить фильтры"}
            accessibilityState={{ disabled: nothingActive && !undo }}
            hitSlop={12}
            style={({ pressed }) => ({
              minHeight: 44,
              justifyContent: "center",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text
              maxFontSizeMultiplier={1.2}
              numberOfLines={1}
              style={{
                fontSize: 15,
                fontWeight: "600",
                // Выключенная кнопка должна быть ТИШЕ живой: t.faint
                // темнее кобальта и читался как активный.
                color:
                  nothingActive && !undo ? "rgba(11,18,32,0.28)" : t.accent,
              }}
            >
              {undo ? "Вернуть" : "Сбросить"}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Сводка — во всю ширину под шапкой, а не в узкой центральной
          колонке (178 → 362pt): туда помещается реальный набор. */}
      {activeSummary || undo ? (
        <Text
          maxFontSizeMultiplier={1.2}
          numberOfLines={2}
          style={{
            paddingHorizontal: 20,
            marginTop: 3,
            fontSize: 12,
            fontWeight: "500",
            textAlign: "center",
            color: t.faint,
          }}
        >
          {undo ? "Сброшено" : activeSummary}
        </Text>
      ) : null}
    </>
  );
}
