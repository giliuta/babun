import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Check } from "lucide-react-native";
import { TIMEZONE_OPTIONS } from "@babun/shared/local/calendar-settings";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { GradientButton } from "@/components/ui/GradientButton";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { TimeWheelPair } from "@/components/ui/TimeWheel";
import { GUTTER } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { tzLabel } from "@/features/calendar/setting-options";
import { offsetToZone, zoneToOffset } from "@/features/calendar/timezone-offset";

// ЧАСОВОЙ ПОЯС — ГОРОД ИЛИ СВОЁ ВРЕМЯ.
//
// Владелец 2026-08-27: «барабан часовой пояс, не город там, а полноценно
// как везде — как в ноутбуке время выставляется или в телефоне… тумблер
// „своё время"… точно такая же настройка как в телефоне, только под нашим
// дизайном».
//
// ПОЧЕМУ ЭТО ВООБЩЕ НУЖНО. Список городов закрывает 99% случаев, но у него
// два провала: города может не быть в списке, и человек не обязан знать,
// как называется его зона. Зато он ТОЧНО знает, сколько сейчас на его
// часах. «Своё время» спрашивает ровно это.
//
// КАК ХРАНИТСЯ — И ПОЧЕМУ НЕ ЛОМАЕТ ОСТАЛЬНОЕ. Часовой пояс в продукте —
// это строка IANA (`Europe/Nicosia`), и по ней считаются границы суток В
// КАЛЕНДАРЕ, В ФИНАНСАХ И В ОТЧЁТАХ через `Intl`. Записать туда «UTC+3»
// нельзя: `Intl` такую строку не принимает и падает.
//
// Поэтому «своё время» сохраняется НАСТОЯЩЕЙ зоной фиксированного
// смещения — `Etc/GMT±N`. Она есть в базе IANA, её понимает `Intl`, и весь
// существующий код продолжает работать без единой правки.
//
// ЗНАК У `Etc/GMT` ПЕРЕВЁРНУТ, и это не опечатка: `Etc/GMT-3` означает
// UTC+3. Так задумано в самой IANA (POSIX-наследие), и это классический
// источник ошибки на сутки. Инверсия сделана в ОДНОМ месте — `offsetToZone`
// ниже, и закрыта тестом.
//
// ОГРАНИЧЕНИЕ ЧЕСТНОЕ: `Etc/GMT` бывает только целочасовым. Зоны с
// получасовым сдвигом (Индия +5:30, Иран +3:30) через «своё время» не
// выразить — они берутся городом из списка. Минуты на барабане поэтому
// показывают время, но на выбор зоны не влияют; об этом сказано подписью.

/** Минуты кладутся на шаг барабана. Барабан ходит пятиминутками (MINUTE_STEP
 *  на весь продукт), и реальные 14:19 он показывал бы как «20», пока подпись
 *  под ним говорила «14:19» — контрол и его же ответ расходились на минуту с
 *  первого кадра. Поймано в симуляторе 2026-08-27. */
function snapMinute(m: number): number {
  return Math.round(m / 5) * 5 % 60;
}

/** Сколько сейчас времени в этой зоне — часы и минуты. */
function nowInZone(zone: string): { hour: number; minute: number } {
  try {
    const parts = new Intl.DateTimeFormat("ru-RU", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    return { hour: get("hour") % 24, minute: snapMinute(get("minute")) };
  } catch {
    const d = new Date();
    return { hour: d.getHours(), minute: snapMinute(d.getMinutes()) };
  }
}

export function TimezoneSheet({
  visible,
  value,
  onApply,
  onClose,
}: {
  visible: boolean;
  value: string;
  onApply: (zone: string) => void;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const savedOffset = zoneToOffset(value);

  const [custom, setCustom] = useState(savedOffset != null);
  const [zone, setZone] = useState(value);
  const [hour, setHour] = useState(() => nowInZone(value).hour);
  const [minute, setMinute] = useState(() => nowInZone(value).minute);

  // Лист живёт в дереве и гасится пропом `visible` (канон §5): черновик
  // сбрасывается на КАЖДОМ открытии, иначе вчерашние барабаны встретят
  // человека сегодня.
  useEffect(() => {
    if (!visible) return;
    const off = zoneToOffset(value);
    setCustom(off != null);
    setZone(value);
    const now = nowInZone(value);
    setHour(now.hour);
    setMinute(now.minute);
  }, [visible, value]);

  // Смещение, которое даст выставленное на барабане время. Считается от
  // UTC-часа прямо сейчас — то есть человек говорит «у меня сейчас 14:00»,
  // а зона выводится, а не спрашивается.
  const customZone = useMemo(() => {
    const utcHour = new Date().getUTCHours() + new Date().getUTCMinutes() / 60;
    const local = hour + minute / 60;
    let diff = local - utcHour;
    if (diff > 14) diff -= 24;
    if (diff < -12) diff += 24;
    return offsetToZone(diff);
  }, [hour, minute]);

  const result = custom ? customZone : zone;
  const offsetNow = zoneToOffset(customZone) ?? 0;
  const offsetText = `UTC${offsetNow >= 0 ? "+" : "−"}${Math.abs(offsetNow)}`;

  return (
    <BottomSheet
      padded={false}
      visible={visible}
      onClose={onClose}
      title="Часовой пояс"
      scroll
      footer={
        <View style={{ paddingHorizontal: GUTTER }}>
          <GradientButton
            label="Применить"
            onPress={() => {
              onApply(result);
              onClose();
            }}
          />
        </View>
      }
    >
      <View style={{ paddingHorizontal: GUTTER, paddingBottom: 8 }}>
        <View
          className="overflow-hidden rounded-[10px]"
          style={{ backgroundColor: t.surface }}
        >
          <SwitchRow
            label="Своё время"
            hint="Выставить часы вручную, если города нет в списке"
            value={custom}
            onChange={setCustom}
          />
        </View>

        {custom ? (
          <View style={{ marginTop: 12 }}>
            <TimeWheelPair
              hour={hour}
              minute={minute}
              onChangeHour={setHour}
              onChangeMinute={setMinute}
              labelPrefix="Сейчас"
            />
            {/* Ответ на «что я только что выбрал» — словами, а не догадкой.
                Минуты на барабане показывают время, но смещение считается
                целыми часами: зон с получасовым сдвигом в `Etc/GMT` нет. */}
            <Text
              accessibilityLiveRegion="polite"
              style={{
                marginTop: 10,
                textAlign: "center",
                fontSize: 13,
                color: t.sub,
              }}
            >
              Сейчас у вас {String(hour).padStart(2, "0")}:
              {String(minute).padStart(2, "0")} — это {offsetText}
            </Text>
          </View>
        ) : (
          <View
            className="mt-3 overflow-hidden rounded-[10px]"
            style={{ backgroundColor: t.surface }}
          >
            {TIMEZONE_OPTIONS.map((tz, i) => {
              const active = tz === zone;
              return (
                <View key={tz}>
                  {i > 0 ? (
                    <View
                      style={{
                        height: 1,
                        marginLeft: 16,
                        backgroundColor: t.separator,
                      }}
                    />
                  ) : null}
                  <Pressable
                    onPress={() => setZone(tz)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={tzLabel(tz)}
                    style={({ pressed }) => ({
                      minHeight: 48,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                      paddingHorizontal: 16,
                      paddingVertical: 10,
                      backgroundColor: pressed ? t.pressed : "transparent",
                    })}
                  >
                    <Text
                      maxFontSizeMultiplier={1.3}
                      style={{ flex: 1, fontSize: 16, color: t.ink }}
                      numberOfLines={1}
                    >
                      {tzLabel(tz)}
                    </Text>
                    {active ? (
                      <Check color={t.accent} size={18} strokeWidth={2.5} />
                    ) : null}
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}
      </View>
    </BottomSheet>
  );
}
