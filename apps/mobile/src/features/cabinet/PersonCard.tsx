import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { ChevronRight } from "lucide-react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { GUTTER, TYPE } from "@/components/ui/tokens";
import { useSession } from "@/providers/SessionProvider";
import { useThemeColors } from "@/theme/colors";
import { personCardView } from "./person-card";

// КАРТА ЧЕЛОВЕКА — ВЕРХ КАБИНЕТА (владелец 2026-09-15: «как компании не будет,
// будет только как личное»). Прежний герой печатал КОМПАНИЮ — её имя,
// инициалы и роль — и вёл в реквизиты. Кабинет теперь про человека, поэтому
// карта называет его самого (имя, почта, телефон) и ведёт в «Профиль».
//
// Градиент один на продукт — фирменный `accentFrom → accentTo`, как был у
// прежнего героя; второго бренд-оттенка канон не разрешает.
//
// ВСЯ РАСКЛАДКА — СТАТИЧЕСКИМ `style`, без `className`: стиль-функция
// `Pressable` рядом с `className` раскладку не донесла, и аватар, имя и почта
// легли столбцом у самого края карты (iPhone 17, 2026-09-15).

export function PersonCard({ onPress }: { onPress?: () => void }) {
  const t = useThemeColors();
  const { session } = useSession();
  const view = personCardView(session?.user);
  const label = onPress ? `${view.title}, открыть профиль` : view.title;

  // Поле, радиус и кривая угла — те же, что у `SectionCard`: края карты
  // человека и карточек под ней стоят на одной линии.
  const surface: ViewStyle = {
    borderRadius: t.radius.card,
    borderCurve: "continuous",
    overflow: "hidden",
  };

  const content = (
    <>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <LinearGradient id="person" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={t.accentFrom} />
            <Stop offset="1" stopColor={t.accentTo} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#person)" />
      </Svg>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          minHeight: 84,
          paddingHorizontal: 16,
          paddingVertical: 14,
        }}
      >
        <View
          style={{
            width: 56,
            height: 56,
            // Круг: w === h — геометрическое исключение из закона одного радиуса.
            borderRadius: t.radius.pill,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 2,
            borderColor: "rgba(255,255,255,0.7)",
            backgroundColor: "rgba(255,255,255,0.2)",
          }}
        >
          <Text
            maxFontSizeMultiplier={1.2}
            style={{
              fontSize: 20,
              lineHeight: 24,
              fontWeight: "700",
              color: t.onAccent,
            }}
          >
            {view.initials}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            maxFontSizeMultiplier={1.3}
            numberOfLines={1}
            style={{ ...TYPE.headline, color: t.onAccent }}
          >
            {view.title}
          </Text>
          {view.lines.map((line) => (
            <Text
              key={line}
              maxFontSizeMultiplier={1.3}
              numberOfLines={1}
              style={{
                ...TYPE.subhead,
                marginTop: 2,
                color: t.onAccent,
                opacity: 0.85,
              }}
            >
              {line}
            </Text>
          ))}
        </View>
        {onPress ? (
          <ChevronRight color={t.onAccent} size={16} strokeWidth={1.75} />
        ) : null}
      </View>
    </>
  );

  return (
    <View style={{ marginTop: 8, marginHorizontal: GUTTER }}>
      {onPress ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={label}
          style={surface}
        >
          {({ pressed }) => (
            <>
              {content}
              {/* НАЖАТИЕ УГЛУБЛЯЕТ МАТЕРИАЛ, а не гасит карту прозрачностью —
                  тот же закон, что у `SettingsRow`. На градиенте это вуаль. */}
              {pressed ? (
                <View
                  style={[
                    StyleSheet.absoluteFill,
                    { backgroundColor: "rgba(0,0,0,0.08)", pointerEvents: "none" },
                  ]}
                />
              ) : null}
            </>
          )}
        </Pressable>
      ) : (
        <View accessible accessibilityLabel={label} style={surface}>
          {content}
        </View>
      )}
    </View>
  );
}
