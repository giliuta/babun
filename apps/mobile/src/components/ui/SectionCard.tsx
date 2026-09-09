import { type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { Card } from "./Card";
import { GUTTER } from "./tokens";
import { useThemeColors } from "@/theme/colors";

interface SectionCardAction {
  label: string;
  icon?: LucideIcon;
  onPress: () => void;
}

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
  /** Действие в правом краю шапки. Со `icon` рисуется значком, а подпись
   *  уходит в озвучку: у блока типов события это ползунки настроек, и слово
   *  рядом с ними спорило бы с самим заголовком блока.
   *
   *  МАССИВ — когда у блока их два (адрес объекта: «точка на карте» и
   *  «попросить у клиента»). Больше двух в шапку не ставят: третий значок в
   *  капс-строке читается уже как панель инструментов. */
  action?: SectionCardAction | SectionCardAction[];
  padded?: boolean;
  className?: string;
  /** Identity-tint override for the eyebrow (defaults to neutral faint). The
   *  caller passes an already-AA-guarded colour; falls back to faint. */
  eyebrowColor?: string;
  children: ReactNode;
}) {
  const t = useThemeColors();
  const actions = action ? (Array.isArray(action) ? action : [action]) : [];
  return (
    <View className={`mt-2 ${className}`} style={{ marginHorizontal: GUTTER }}>
      <Card>
        {title ? (
          // ВЫСОТУ ШАПКИ ЗАДАЁТ ТОЛЬКО ПОДПИСЬ (владелец 2026-09-08: «отступ
          // от начала блока до слова должен быть одинаково — клиент, объект,
          // заметка, тип события, всё в одной архитектуре, по пикселям»).
          // Кнопка действия стояла в потоке строки со своими 44pt высоты, и
          // подпись, выровненная по центру, съезжала вниз на шесть пикселей:
          // у блока с действием шапка начиналась ниже, чем у соседей.
          // Кнопка ушла в абсолют — на поток она больше не влияет, а 44pt
          // зоны касания ей даёт hitSlop.
          <View className="relative flex-row items-center px-4 pb-0.5 pt-2.5">
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
            {/* КОМАНДЫ — ОДНОЙ АБСОЛЮТНОЙ СТРОКОЙ У ПРАВОГО КРАЯ. В потоке
                они меняли бы высоту шапки, и подпись блока с командой стояла
                бы ниже, чем у соседей (правка 2026-09-08); абсолютом их
                высота на поток не влияет, а до 44pt зону касания добирает
                hitSlop. Ряд, а не один значок: у адреса объекта их два. */}
            {actions.length > 0 ? (
              <View
                style={{
                  position: "absolute",
                  right: 16,
                  // Значок 20pt по центру подписи (11pt, строка ~13):
                  // 10 сверху у шапки минус половина разницы высот.
                  top: 6,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 16,
                }}
              >
                {actions.map((item) => (
                  <Pressable
                    key={item.label}
                    onPress={item.onPress}
                    hitSlop={12}
                    accessibilityRole="button"
                    accessibilityLabel={item.label}
                    style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1 })}
                  >
                    {item.icon ? (
                      <item.icon color={t.sub} size={20} strokeWidth={2} />
                    ) : (
                      <Text
                        style={{ fontSize: 14, fontWeight: "500", color: t.accent }}
                      >
                        {item.label}
                      </Text>
                    )}
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
        {padded ? <View className="p-4 pt-2">{children}</View> : children}
      </Card>
    </View>
  );
}
