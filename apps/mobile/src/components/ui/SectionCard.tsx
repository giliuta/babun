import { type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Plus } from "lucide-react-native";
import { Card } from "./Card";
import { GUTTER } from "./tokens";
import { useThemeColors } from "@/theme/colors";

// Grouped-iOS card. Reuses the light Card surface (radius 14, frosted edge).
// No inner padding by default (lists sit flush); pass
// `padded` for form/content cards.
// Отступ от краёв — общий `GUTTER` (16): вторая карточная примитива продукта
// (`RowGroupBody`) отступает так же, и на экране, где встречаются обе, их
// края обязаны стоять на одной линии.
export function SectionCard({
  title,
  action,
  padded,
  className = "",
  eyebrowColor,
  children,
}: {
  title?: string;
  /** Действие в шапке. `icon: "add"` — маленький кружок с плюсом вместо
   *  надписи; `label` остаётся для VoiceOver.
   *
   *  ЕДИНСТВЕННЫЙ ПЛЮС В ПРОДУКТЕ. Универсальный плюсик для создания снят
   *  политикой (`ui-policy-contract`: строки добавления говорят словами —
   *  «Добавить номер», «Создать счёт»). Владелец 2026-09-06 попросил его
   *  обратно ровно в одном месте — в шапке блока «Файлы»: «маленькая шапка
   *  „Файлы“, справа плюсик; нажимаю — вылазит лист». Поэтому значок не
   *  передаётся снаружи, а выбирается токеном здесь: второго плюса без
   *  слова владельца не появится. */
  action?: { label: string; onPress: () => void; icon?: "add" };
  padded?: boolean;
  className?: string;
  /** Identity-tint override for the eyebrow (defaults to neutral faint). The
   *  caller passes an already-AA-guarded colour; falls back to faint. */
  eyebrowColor?: string;
  children: ReactNode;
}) {
  const t = useThemeColors();
  return (
    <View className={`mt-2 ${className}`} style={{ marginHorizontal: GUTTER }}>
      <Card>
        {title ? (
          <View className="flex-row items-center justify-between px-4 pb-0.5 pt-2.5">
            <Text
              accessibilityRole="header"
              // Caption tier (DS §2: 11/700/+0.6 uppercase) — same recipe as
              // SectionHeader in Card.tsx so section eyebrows match app-wide.
              style={{
                fontSize: 11,
                fontWeight: "700",
                letterSpacing: 0.6,
                textTransform: "uppercase",
                color: eyebrowColor ?? t.faint,
              }}
            >
              {title}
            </Text>
            {action?.icon ? (
              <Pressable
                onPress={action.onPress}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                hitSlop={10}
                style={({ pressed }) => ({
                  width: 26,
                  height: 26,
                  borderRadius: 13,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: `${t.accent}14`,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Plus color={t.accent} size={15} strokeWidth={2.4} />
              </Pressable>
            ) : action ? (
              <Pressable
                onPress={action.onPress}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                style={({ pressed }) => ({
                  minHeight: 44,
                  justifyContent: "center",
                  paddingLeft: 12,
                  opacity: pressed ? 0.65 : 1,
                })}
              >
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
