import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Calendar, X } from "lucide-react-native";
import { getStorage } from "@babun/shared/storage";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";

// Календарь есть, записей ещё нет — web parity CalendarEmptyState (STORY-059).
// На мобиле этого состояния не существовало вовсе: онбординг-карточка гасла
// после первого же шага, и человек оставался наедине с пустой сеткой без
// единой подсказки, что делать.
//
// Форма — тихая строка-подсказка над таб-баром, а НЕ карточка по центру:
// пустая разлинованная сетка это не ошибка, а свободный вторник. Закрыть
// можно навсегда (MMKV).

const DISMISS_KEY = "babun:hint-calendar-empty-dismissed";

/** Ближайший разумный слот: до 09:00 → 10:00 сегодня; днём → следующий час;
 *  после 18:00 → 10:00 завтра. Кнопка обязана открывать форму на времени,
 *  куда действительно записывают. */
export function suggestFirstSlot(now: Date): { date: Date; time: string } {
  const h = now.getHours();
  if (h < 9) return { date: now, time: "10:00" };
  if (h < 18) {
    const next = Math.min(h + 1, 19);
    return { date: now, time: `${String(next).padStart(2, "0")}:00` };
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return { date: tomorrow, time: "10:00" };
}

export function CalendarEmptyState({ onCreate }: { onCreate: () => void }) {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  const [dismissed, setDismissed] = useState(
    () => getStorage().getRaw(DISMISS_KEY) === "1",
  );

  if (dismissed) return null;

  const dismiss = () => {
    getStorage().setRaw(DISMISS_KEY, "1");
    setDismissed(true);
  };

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 12,
        right: 12,
        bottom: insets.bottom + 12,
      }}
    >
      <View
        accessibilityLiveRegion="polite"
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingLeft: 14,
          paddingRight: 6,
          paddingVertical: 10,
          borderRadius: t.radius.card,
          borderWidth: 1,
          borderColor: t.separator,
          backgroundColor: t.surface,
          boxShadow: t.cardShadow,
        }}
      >
        <Calendar color={t.accent} size={ICON.sm} strokeWidth={2.2} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 15, fontWeight: "600", color: t.ink }}>
            Пока нет записей
          </Text>
          {/* hitSlop 14: единственный выход из пустого состояния, и в него
              целятся большим пальцем на ходу. Голый текст 14pt давал полосу
              ~17px — втрое меньше минимума HIG. */}
          <Pressable
            onPress={onCreate}
            hitSlop={{ top: 8, bottom: 14, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Добавить первую запись"
            style={({ pressed }) => ({
              paddingTop: 2,
              paddingBottom: 4,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text style={{ fontSize: 14, fontWeight: "600", color: t.accent }}>
              Добавить первую запись
            </Text>
          </Pressable>
        </View>
        <Pressable
          onPress={dismiss}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Скрыть подсказку"
          style={({ pressed }) => ({
            height: 32,
            width: 32,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 16,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <X color={t.faint} size={ICON.xs} strokeWidth={2.2} />
        </Pressable>
      </View>
    </View>
  );
}
