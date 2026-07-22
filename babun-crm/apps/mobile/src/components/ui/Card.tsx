import { type ReactNode } from "react";
import { Text, View, type ViewProps } from "react-native";
import { useThemeColors } from "@/theme/colors";

// «Halo Cobalt» surfaces — apps/mobile/docs/DESIGN-SYSTEM.md.

// Grouped card: soft neutral elevation on the fixed light canvas plus a 1px
// frosted top-edge highlight that reads as glass thickness.
export function Card({
  style,
  children,
  ...rest
}: ViewProps & { children?: ReactNode }) {
  const t = useThemeColors();
  return (
    <View
      {...rest}
      style={[
        {
          borderRadius: t.radius.card,
          backgroundColor: t.surface,
          overflow: "hidden",
          boxShadow: t.cardShadow,
        },
        style,
      ]}
    >
      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 1,
          backgroundColor: t.highlight,
        }}
      />
      {children}
    </View>
  );
}

// Caption eyebrow above a section («ОПЕРАЦИИ», day dividers, settings groups).
export function SectionHeader({ children }: { children: string }) {
  const t = useThemeColors();
  return (
    <Text
      accessibilityRole="header"
      style={{
        fontSize: 11,
        fontWeight: "700",
        letterSpacing: 0.6,
        color: t.faint,
        textTransform: "uppercase",
        marginTop: 24,
        marginBottom: 8,
        marginLeft: 4,
      }}
    >
      {children}
    </Text>
  );
}
