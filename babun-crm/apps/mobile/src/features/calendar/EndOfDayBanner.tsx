import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { X } from "lucide-react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import { getDebtAmount } from "@babun/shared/local/appointments";
import { getStorage } from "@babun/shared/storage";
import { useThemeColors } from "@/theme/colors";

// После 18:00, если у выполненных СЕГОДНЯ визитов остался долг — плавающая
// карточка «N без оплаты · Закройте до конца дня» с CTA (web EndOfDayBanner).
// Незакрытая оплата иначе тихо уезжает в дебиторку. Dismiss — на день.
const DISMISS_PREFIX = "babun:end-of-day-dismissed:";

export function EndOfDayBanner({
  appointments,
  todayYmd,
  nowHour,
  onOpenUnpaid,
}: {
  /** Записи СЕГОДНЯ, уже отфильтрованные по команде. */
  appointments: Appointment[];
  todayYmd: string;
  /** Час бизнес-таймзоны (баннер живёт с 18:00). */
  nowHour: number;
  onOpenUnpaid: () => void;
}) {
  const t = useThemeColors();
  const [dismissed, setDismissed] = useState(
    () => getStorage().getRaw(`${DISMISS_PREFIX}${todayYmd}`) === "1",
  );
  // Экран может жить через полночь: dismiss вчерашнего дня не должен прятать
  // баннер нового (web перечитывает флаг каждый день).
  const [seenYmd, setSeenYmd] = useState(todayYmd);
  if (seenYmd !== todayYmd) {
    setSeenYmd(todayYmd);
    setDismissed(getStorage().getRaw(`${DISMISS_PREFIX}${todayYmd}`) === "1");
  }

  const unpaidCount = useMemo(() => {
    let n = 0;
    for (const apt of appointments) {
      if (apt.status !== "completed") continue;
      if (getDebtAmount(apt) > 0) n++;
    }
    return n;
  }, [appointments]);

  if (nowHour < 18 || dismissed || unpaidCount === 0) return null;

  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", left: 12, right: 12, bottom: 56 }}
    >
      <View
        className="flex-row items-center gap-2 px-3 py-2.5"
        style={{
          borderRadius: 14,
          backgroundColor: t.surface,
          boxShadow: t.cardShadow,
        }}
      >
        <View
          className="items-center justify-center"
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            backgroundColor: t.warning,
          }}
        >
          <Text style={{ fontSize: 16, color: t.onAccent }}>!</Text>
        </View>
        <View className="flex-1" style={{ minWidth: 0 }}>
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}
            style={{ fontSize: 13, fontWeight: "600", color: t.ink }}
          >
            {unpaidCount}{" "}
            {unpaidCount === 1 ? "запись без оплаты" : "записей без оплаты"}
          </Text>
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}
            style={{ fontSize: 12, color: t.sub }}
          >
            Закройте до конца дня
          </Text>
        </View>
        <Pressable
          onPress={onOpenUnpaid}
          accessibilityRole="button"
          className="rounded-full px-3 active:opacity-70"
          style={{ height: 32, justifyContent: "center", backgroundColor: t.accent }}
        >
          <Text style={{ fontSize: 13, fontWeight: "600", color: t.onAccent }}>
            Открыть
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            setDismissed(true);
            const storage = getStorage();
            // Ключ нужен только до конца дня — прошлые чистим, чтобы MMKV
            // не копил по ключу на каждый прожитый день.
            const todayKey = `${DISMISS_PREFIX}${todayYmd}`;
            for (const key of storage.list(DISMISS_PREFIX)) {
              if (key !== todayKey) storage.remove(key);
            }
            storage.setRaw(todayKey, "1");
          }}
          accessibilityRole="button"
          accessibilityLabel="Скрыть"
          className="items-center justify-center rounded-full active:opacity-70"
          style={{ width: 32, height: 32, backgroundColor: t.fill }}
        >
          <X color={t.sub} size={14} strokeWidth={2.5} />
        </Pressable>
      </View>
    </View>
  );
}
