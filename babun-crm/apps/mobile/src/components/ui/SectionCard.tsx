import { type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Card } from "./Card";
import { useThemeColors } from "@/theme/colors";

// Grouped-iOS card. Reuses the themed Card surface (radius 20, frosted edge,
// tone-lift in dark). No inner padding by default (lists sit flush); pass
// `padded` for form/content cards.
export function SectionCard({
  title,
  action,
  padded,
  className = "",
  children,
}: {
  title?: string;
  action?: { label: string; onPress: () => void };
  padded?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const t = useThemeColors();
  return (
    <View className={`mx-3 mt-2 ${className}`}>
      <Card>
        {title ? (
          <View className="flex-row items-center justify-between px-4 pb-1 pt-3">
            <Text
              // Caption tier (DS §2: 11/700/+0.6 uppercase) — same recipe as
              // SectionHeader in Card.tsx so section eyebrows match app-wide.
              style={{
                fontSize: 11,
                fontWeight: "700",
                letterSpacing: 0.6,
                textTransform: "uppercase",
                color: t.faint,
              }}
            >
              {title}
            </Text>
            {action ? (
              <Pressable onPress={action.onPress} hitSlop={8}>
                <Text style={{ fontSize: 14, fontWeight: "500", color: t.accent }}>
                  {action.label}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {padded ? <View className="p-4 pt-2">{children}</View> : children}
      </Card>
    </View>
  );
}
