import { Text, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { CalendarDays } from "lucide-react-native";
import { GradientButton } from "@/components/ui/GradientButton";
import { useThemeColors } from "@/theme/colors";

const FILL = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 } as const;

// Web parity: apps/web/src/components/empty-states/FirstRunCalendarChoice.tsx.
// Shown by the calendar tab when the tenant has no team calendar yet. One
// CTA spins up the first team calendar; «Мой календарь» stays parked (web
// PERSONAL_CALENDAR_ENABLED), so the only first-run path is a team calendar.
export function FirstRunCalendarChoice({
  onCreate,
  creating,
}: {
  onCreate: () => void;
  creating?: boolean;
}) {
  const t = useThemeColors();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: t.canvas,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 24,
      }}
    >
      <View style={{ width: "100%", maxWidth: 360, alignItems: "center" }}>
        {/* Brand-gradient calendar mark — same cobalt
            gradient recipe as the primary button (DS: the only gradients). */}
        <View
          style={{
            height: 64,
            width: 64,
            borderRadius: 18,
            overflow: "hidden",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 16,
            boxShadow: t.brandShadow,
          }}
        >
          <Svg style={FILL} width="100%" height="100%" pointerEvents="none">
            <Defs>
              <LinearGradient id="cal-mark" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={t.accentFrom} />
                <Stop offset="1" stopColor={t.accentTo} />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill="url(#cal-mark)" />
          </Svg>
          <CalendarDays color={t.onAccent} size={30} strokeWidth={2} />
        </View>

        <Text
          style={{
            fontSize: 22,
            fontWeight: "600",
            color: t.ink,
            textAlign: "center",
            letterSpacing: -0.3,
          }}
        >
          Здесь будет ваш календарь
        </Text>
        <Text
          style={{
            marginTop: 8,
            fontSize: 14,
            lineHeight: 20,
            color: t.sub,
            textAlign: "center",
          }}
        >
          Календарь — это расписание, куда вы записываете клиентов по дням и
          часам. Создайте первый — и можно начинать.
        </Text>

        <View style={{ marginTop: 24, width: "100%" }}>
          <GradientButton
            label="Создать календарь"
            onPress={onCreate}
            loading={creating}
          />
        </View>
      </View>
    </View>
  );
}
