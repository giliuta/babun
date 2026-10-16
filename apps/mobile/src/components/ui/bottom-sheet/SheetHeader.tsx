import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { GestureDetector, type Gesture } from "react-native-gesture-handler";
import { useThemeColors } from "@/theme/colors";

/** Grabber and title of `BottomSheet`, both inside the drag-to-close gesture. */
export function SheetHeader({
  drag,
  grabber,
  title,
  subtitle,
  headerAction,
}: {
  drag: ReturnType<typeof Gesture.Pan>;
  grabber: boolean;
  title?: string;
  subtitle?: string;
  headerAction?: ReactNode;
}) {
  const t = useThemeColors();
  return (
    <GestureDetector gesture={drag}>
      <View>
        {grabber ? (
          <View className="items-center pb-1 pt-2.5">
            <View
              style={{
                width: 36,
                height: 5,
                borderRadius: 3,
                // «Чёрное не серое»: separator на surface ~1.1:1 — жест
                // обещан, а язычка не видно. Ink+alpha, как у системного.
                backgroundColor: "rgba(11,18,32,0.14)",
              }}
            />
          </View>
        ) : null}
        {title ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingTop: grabber ? 4 : 12,
              paddingBottom: 12,
            }}
          >
            {/* Заголовок остаётся ПО ЦЕНТРУ ЛИСТА: пустышка слева той же
                ширины, что действие справа, иначе имя уезжает влево тем
                сильнее, чем крупнее системный шрифт. */}
            <View style={{ width: 44 }} />
            <View style={{ flex: 1, minWidth: 0, alignItems: "center" }}>
              <Text
                accessibilityRole="header"
                maxFontSizeMultiplier={1.2}
                numberOfLines={1}
                style={{
                  fontSize: 17,
                  fontWeight: "600",
                  textAlign: "center",
                  color: t.ink,
                }}
              >
                {title}
              </Text>
              {subtitle ? (
                <Text
                  maxFontSizeMultiplier={1.2}
                  numberOfLines={1}
                  style={{
                    marginTop: 2,
                    fontSize: 13,
                    textAlign: "center",
                    color: t.sub,
                  }}
                >
                  {subtitle}
                </Text>
              ) : null}
            </View>
            <View
              style={{
                width: 44,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {headerAction}
            </View>
          </View>
        ) : null}
      </View>
    </GestureDetector>
  );
}
