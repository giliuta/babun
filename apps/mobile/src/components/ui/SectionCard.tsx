import { type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { Card } from "./Card";
import { GUTTER, ICON } from "./tokens";
import { capsText } from "./caps-text";
import { useThemeColors } from "@/theme/colors";

interface SectionCardAction {
  label: string;
  icon?: LucideIcon;
  /** Значок акцентом — действие над содержимым блока (точка на карте, запрос
   *  адреса), а не дверь в настройки: та остаётся серой. */
  accent?: boolean;
  /** ПЛАШКА «ЕЩЁ N»: показывает, что там есть ещё, и сколько. Подпись — в мягкой
   *  акцентной пилюле; высоту шапки не меняет. */
  pill?: boolean;
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
  dense,
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
  /** ПЛОТНЫЙ СЛУЧАЙ — ФОРМА В ШТОРКЕ.
   *  На странице блоков два-три и им есть куда дышать; в шторке
   *  их шесть, и просвет с воздухом под шапкой набегают в полсотни точек.
   *  Шапка и содержимое те же — тише только воздух. */
  dense?: boolean;
  className?: string;
  /** Identity-tint override for the eyebrow (defaults to full ink — the
   *  group name, DS §1). The caller passes an already-AA-guarded colour. */
  eyebrowColor?: string;
  children: ReactNode;
}) {
  const t = useThemeColors();
  const actions = action ? (Array.isArray(action) ? action : [action]) : [];
  return (
    <View
      className={`${dense ? "mt-1.5" : "mt-2"} ${className}`}
      style={{ marginHorizontal: GUTTER }}
    >
      <Card>
        {title ? (
          // ВЫСОТУ ШАПКИ ЗАДАЁТ ТОЛЬКО ПОДПИСЬ: отступ от начала блока до слова
          // одинаков у клиента, объекта, заметки, типа события — по пикселям.
          // Кнопка действия в потоке строки (44pt высоты) сдвигала бы подпись,
          // выровненную по центру, вниз на шесть пикселей, и у блока с действием
          // шапка начиналась бы ниже, чем у соседей. Поэтому кнопка в абсолюте:
          // на поток она не влияет, а 44pt зоны касания ей даёт hitSlop.
          //
          // `dense` — форма в шторке: блоков шесть, и воздух под шапкой
          // набегает в полсотни точек. Устройство
          // шапки то же, тише только воздух.
          <View
            className={`relative flex-row items-center px-4 ${
              dense ? "pb-0 pt-1.5" : "pb-0.5 pt-2.5"
            }`}
            // Пилюля «Ещё N» (22pt) на 3pt ниже шапки: без подъёма белая
            // плашка первой строки ложилась поверх и срезала ей низ.
            style={{ zIndex: 1 }}
          >
            <Text
              accessibilityRole="header"
              // Caption tier (DS §2: 11/700/+0.6 uppercase) — same recipe as
              // SectionHeader in Card.tsx so section eyebrows match app-wide.
              style={{
                fontSize: 11,
                fontWeight: "700",
                letterSpacing: 0.6,
                // Имя группы — полный чёрный (DS §1 «серого нет»).
                color: eyebrowColor ?? t.ink,
              }}
            >
              {capsText(title)}
            </Text>
            {/* КОМАНДЫ — ОДНОЙ АБСОЛЮТНОЙ СТРОКОЙ У ПРАВОГО КРАЯ. В потоке
                они меняли бы высоту шапки, и подпись блока с командой стояла
                бы ниже, чем у соседей; абсолютом их
                высота на поток не влияет, а до 44pt зону касания добирает
                hitSlop. Ряд, а не один значок: у адреса объекта их два. */}
            {actions.length > 0 ? (
              <View
                style={{
                  position: "absolute",
                  right: 16,
                  // Значок `ICON.command` (18) по центру подписи (11pt, строка
                  // ~13): 10 сверху у шапки минус половина разницы высот; в
                  // плотной шапке сверху 6 — значок на те же 4 выше.
                  top: dense ? 3 : 7,
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
                      <item.icon color={item.accent ? t.accent : t.sub} size={ICON.command} strokeWidth={2} />
                    ) : item.pill ? (
                      <View
                        style={{
                          height: 22,
                          paddingHorizontal: 10,
                          borderRadius: 11,
                          justifyContent: "center",
                          backgroundColor: `${t.accent}14`,
                        }}
                      >
                        <Text
                          maxFontSizeMultiplier={1.2}
                          style={{ fontSize: 13, fontWeight: "600", color: t.accent, fontVariant: ["tabular-nums"] }}
                        >
                          {item.label}
                        </Text>
                      </View>
                    ) : (
                      <Text
                        style={{ fontSize: 13, fontWeight: "500", color: t.accent }}
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
