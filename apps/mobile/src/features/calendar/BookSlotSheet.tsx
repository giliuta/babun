import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import {
  ITEM_H,
  MINUTE_STEP,
  PAD,
  TimeWheelPair,
} from "@/components/ui/TimeWheel";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import { pad2, parseYMD } from "@/features/appointments/helpers";
import type { WorkBand } from "@/features/calendar/DayView";

// Тап по пустому слоту сетки → этот лист (веб-паритет слот-попапа
// babun.app, только снизу — закон «создание — листом»): дата УЖЕ выбрана
// тапом и стоит по центру шапки, барабаны правят только время (канонический
// `TimeWheelPair` — закольцованные часы и пятиминутки, DS §5), внизу две
// дороги создания стопкой: «Событие» и главная «Клиент». /book открывается
// уже с выбранными временем и типом.
//
// Время вне рабочих часов команды подсвечивается, но НЕ блокируется
// (владелец: «даёт понять, что сотрудник уже не работает, но всё равно даёт
// создать» — аварийные выезды ставят сознательно): амбер-полоса за выбранным
// рядом + t.warning на активных цифрах + тихая подпись со словами словаря
// reschedule-warning. Полоса дня — тот же резолвер, что серый wash сетки.

export type SlotDraft = { date: string; time: string };

const FADE_MS = 140;

const minToHM = (min: number) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;

function dateLabel(date: string): string {
  const s = parseYMD(date).toLocaleDateString("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "long",
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Состояние выбранной точки относительно рабочей полосы дня. Границы
// полуоткрытые — паритет с wash сетки: startMin включительно (08:00 при
// смене с 08:00 — рабочее), endMin исключительно (19:00 ровно — уже вне).
export type OffState =
  | { kind: "outside"; band: WorkBand }
  | { kind: "break"; startMin: number; endMin: number }
  | { kind: "dayoff" }
  | null;

export function offStateAt(band: WorkBand | null | undefined, minute: number): OffState {
  if (band === undefined) return null;
  if (band === null) return { kind: "dayoff" };
  // Fail-safe: мусорная полоса (endMin ≤ startMin) — молча «рабочее»,
  // никогда не гадать амбером.
  if (band.endMin <= band.startMin) return null;
  const brk = band.breaks?.find((b) => minute >= b.startMin && minute < b.endMin);
  if (brk) return { kind: "break", startMin: brk.startMin, endMin: brk.endMin };
  if (minute < band.startMin || minute >= band.endMin)
    return { kind: "outside", band };
  return null;
}

// Словарь — дословно reschedule-warning.ts (один словарь на всё приложение);
// хвост с диапазоном отвечает диспетчеру на следующий вопрос клиента —
// «а до скольких они работают?».
export function captionFor(off: NonNullable<OffState>): string {
  switch (off.kind) {
    case "dayoff":
      return "Нерабочий день команды";
    case "break":
      return `Попадает на перерыв команды · ${minToHM(off.startMin)}–${minToHM(off.endMin)}`;
    case "outside":
      return `Вне рабочих часов команды · работают ${minToHM(off.band.startMin)}–${minToHM(off.band.endMin)}`;
  }
}

export function BookSlotSheet({
  slot,
  bandFor,
  onClose,
  onPick,
}: {
  /** Тапнутый слот; null = лист закрыт. */
  slot: SlotDraft | null;
  /** Рабочая полоса дня (null = выходной, undefined = график неизвестен —
   *  сигнала нет) — тот же резолвер, что красит серый wash сетки. */
  bandFor?: (dateYmd: string) => WorkBand | null | undefined;
  onClose: () => void;
  /** Выбор дороги создания — родитель закрывает лист и открывает /book. */
  onPick: (kind: "work" | "event", slot: SlotDraft) => void;
}) {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<SlotDraft | null>(slot);

  // Появление/затухание сигнала — только opacity, ничего не едет (закон
  // движения DS). Объявлены до эффекта открытия: он снапит их значения.
  const bandOpacity = useSharedValue(0);

  // Ресинк черновика — по фронту открытия: пока лист открыт, колесо
  // владеет значением, тики календаря его не перескакивают. Там же
  // взводится одноразовость выбора (pickedRef) и «тихое открытие»
  // хаптики (prevOffRef).
  const wasOpen = useRef(false);
  const pickedRef = useRef(false);
  const prevOffRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (slot && !wasOpen.current) {
      setDraft(slot);
      pickedRef.current = false;
      prevOffRef.current = null;
      // Снап визуала к состоянию НОВОГО слота без анимации: компонент
      // смонтирован постоянно, и янтарь прошлого сеанса иначе дотаивал бы
      // на входе листа (140мс фейд поверх пружины входа).
      const [sh, sm] = slot.time.split(":").map(Number);
      const off = offStateAt(
        bandFor?.(slot.date),
        (sh || 0) * 60 + (sm || 0),
      );
      bandOpacity.value =
        off?.kind === "outside" || off?.kind === "break" ? 1 : 0;
    }
    wasOpen.current = slot != null;
  }, [slot, bandFor, bandOpacity]);

  const [h, m] = (draft?.time ?? "10:00").split(":").map(Number);
  const hourIdx = Math.max(0, Math.min(23, h || 0));
  const minIdx = Math.max(0, Math.min(60 / MINUTE_STEP - 1, Math.floor((m || 0) / MINUTE_STEP)));
  // Каждая колонка переписывает ТОЛЬКО свою половину от ПРЕДЫДУЩЕГО
  // черновика: сборка всего HH:MM из индексов замыкания теряла коммит
  // соседней колонки, когда два коммита попадали в один батч React.
  const setHour = (h: number) =>
    setDraft((d) =>
      d ? { ...d, time: `${pad2(h)}:${d.time.split(":")[1] ?? "00"}` } : d,
    );
  const setMin = (minute: number) =>
    setDraft((d) =>
      d ? { ...d, time: `${d.time.split(":")[0] ?? "00"}:${pad2(minute)}` } : d,
    );

  const offState = draft
    ? offStateAt(bandFor?.(draft.date), hourIdx * 60 + minIdx * MINUTE_STEP)
    : null;
  // ВЫХОДНОЙ ТОЖЕ КРАСИТ БАРАБАН. Раньше он был исключением — «тело дня
  // чистое, сигнал текстом», но с 2026-08-17 колонка выходного закрашена целиком
  // (DayView), и держать самый сильный «мы не работаем» единственным без амбера
  // значит выдавать его за обычное время.
  const amberOn = offState != null;
  const captionOn = offState != null;

  useEffect(() => {
    bandOpacity.value = withTiming(amberOn ? 1 : 0, { duration: FADE_MS });
  }, [amberOn, bandOpacity]);
  const bandStyle = useAnimatedStyle(() => ({ opacity: bandOpacity.value }));

  // Один тихий тик на commit-переходе рабочее→вне (не на открытии уже во
  // «вне» — серый слот сетки только что сказал то же самое, не отчитываем).
  // Гейт по slot, не по draft: черновик переживает закрытие, и смена
  // bandFor (переключение команды, рефетч графика) при закрытом листе
  // иначе жужжала бы фантомным предупреждением.
  // VoiceOver отдельно не объявляем: состояние уже читается суффиксом
  // accessibilityValue колеса — announce тем же коммитом перебивал бы
  // родную озвучку только что выбранного значения.
  useEffect(() => {
    if (!slot || !draft) return;
    if (prevOffRef.current === null) {
      prevOffRef.current = captionOn;
      return;
    }
    if (captionOn && !prevOffRef.current) haptics.warning();
    prevOffRef.current = captionOn;
  }, [captionOn, slot, draft]);

  const pick = (kind: "work" | "event") => {
    // Одноразово: лист остаётся тапабельным 240 мс анимации закрытия, и
    // быстрый двойной тап открывал бы /book дважды (стопка экранов).
    if (!draft || pickedRef.current) return;
    pickedRef.current = true;
    haptics.tap();
    onPick(kind, draft);
  };

  const voSuffix = captionOn ? ", вне рабочих часов" : undefined;

  return (
    <BottomSheet padded={false} visible={slot != null} onClose={onClose}
    >
      {draft ? (
        <View
          className="px-5 pt-1"
          // Канон нижнего отступа листов (ClientsFilterSheet): home-индикатор
          // не срезает кнопки, на устройствах без него — честные 24.
          style={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}
        >
          {/* Дата выбрана самим тапом — по центру шапки, не в колесе.
              Времени здесь нет: его в 26pt показывает само колесо, живой
              дубликат в шапке тикал бы на периферии. Шапка никогда не
              тонируется — проблема не в дате, а в часе. */}
          <Text
            accessibilityRole="header"
            maxFontSizeMultiplier={1.2}
            className="text-[17px] font-semibold"
            style={{ color: t.ink, textAlign: "center" }}
          >
            {dateLabel(draft.date)}
          </Text>

          {/* Колесо только времени, минуты — по 5. Амбер-полоса лежит ПОД
              колонками и хеарлайнами: структура остаётся чернилами. */}
          <View className="flex-row items-center justify-center py-3">
            <View style={{ flexDirection: "row", alignItems: "center", position: "relative" }}>
              <Animated.View
                pointerEvents="none"
                style={[
                  {
                    position: "absolute",
                    left: -6,
                    right: -6,
                    top: PAD,
                    height: ITEM_H,
                    borderRadius: t.radius.input,
                    // Материал warning-карточки: белый + 12% предупреждения.
                    backgroundColor: `${t.warning}14`,
                  },
                  bandStyle,
                ]}
              />
              <TimeWheelPair
                hour={hourIdx}
                minute={minIdx * MINUTE_STEP}
                onChangeHour={setHour}
                onChangeMinute={setMin}
                labelPrefix="Время записи"
                activeColor={amberOn ? t.warning : undefined}
                accessibilityValueSuffix={voSuffix}
              />
            </View>
          </View>

          <View style={{ height: 6 }} />

          {/* Две дороги создания стопкой (веб-паритет): Клиент — главная.
              Никогда не тонируются и не блокируются — вне часов запись
              разрешена, сигнал уже сказан колесом и подписью. */}
          <View style={{ gap: 10 }}>
            <Button
              label="Событие"
              variant="secondary"
              accessibilityHint="Откроет новое событие на выбранное время"
              onPress={() => pick("event")}
            />
            <Button
              label="Клиент"
              accessibilityHint="Откроет новую запись клиенту на выбранное время"
              onPress={() => pick("work")}
            />
          </View>
        </View>
      ) : null}
    </BottomSheet>
  );
}
