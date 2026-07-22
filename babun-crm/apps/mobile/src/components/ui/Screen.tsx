import { type ReactNode } from "react";
import { View } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useThemeColors } from "@/theme/colors";

// Base screen wrapper. Encapsulates the SafeAreaView flex/bg (NativeWind v5
// className doesn't apply to wrapper components yet, so the wrapper uses
// inline style ONCE here, driven by the theme). The inner View is a core RN
// component → className works, so callers style content via `className`.
export function Screen({
  children,
  className = "",
  edges,
  bg,
}: {
  children: ReactNode;
  className?: string;
  edges?: readonly Edge[];
  /** Ground colour override (defaults to the neutral canvas). The booking
   *  screen feeds it a soft identity wash so the whole page — including the
   *  top safe area — lifts in the appointment's colour. */
  bg?: string;
}) {
  const t = useThemeColors();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: bg ?? t.canvas }} edges={edges}>
      <StatusBar style={t.statusBar} />
      <View className={`flex-1 ${className}`}>{children}</View>
    </SafeAreaView>
  );
}
