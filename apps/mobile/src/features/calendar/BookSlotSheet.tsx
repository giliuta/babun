import { useFeatureOn } from "@/features/settings/company-features";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { MINUTE_STEP, TimeWheelPair } from "@/components/ui/TimeWheel";
import { haptics } from "@/lib/haptics";
import { pad2, parseYMD } from "@/features/appointments/helpers";
import { usePlanAllows } from "@/session/tenant";
import { TariffLocked } from "@/features/tariffs/TariffLocked";
import { FOOTER_SIDE } from "@/components/ui/tokens";

// Тап по пустому слоту сетки → этот лист (веб-паритет слот-попапа
// babun.app, только снизу — закон «создание — листом»): дата УЖЕ выбрана
// тапом и стоит по центру шапки, барабаны правят только время (канонический
// `TimeWheelPair` — закольцованные часы и пятиминутки, DS §5), внизу две
// дороги создания стопкой: «Событие» и главная «Клиент». /book открывается
// уже с выбранными временем и типом.
//
// БАРАБАН РОВНЫЙ: ни янтаря, ни подписи «Вне рабочих часов» — нерабочее
// время человек уже видит серым на сетке, где тапнул.

export type SlotDraft = { date: string; time: string };

function dateLabel(date: string): string {
  const s = parseYMD(date).toLocaleDateString("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "long",
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function BookSlotSheet({
  slot,
  onClose,
  onPick,
  canWork = true,
  canEvent = true,
}: {
  /** Тапнутый слот; null = лист закрыт. */
  slot: SlotDraft | null;
  onClose: () => void;
  /** Выбор дороги создания. Зовётся, когда окно листа уже СНЯТО
   *  (`onExited`): родитель открывает /book, и её шторка клиента не
   *  сталкивается с уходящим листом. */
  onPick: (kind: "work" | "event", slot: SlotDraft) => void;
  /** Права сотрудника в этом календаре (STORY-088): «Новые записи» и
   *  «События: Меняет». Нет права — нет и кнопки, а не кнопка с отказом. */
  canWork?: boolean;
  canEvent?: boolean;
}) {
  // Записывать клиентов умеет платный тариф. Бесплатный личный календарь
  // ведёт события и деньги — этого достаточно для своей жизни и недостаточно
  // для чужих клиентов.
  const canBookClients = usePlanAllows("book-clients");
  const [draft, setDraft] = useState<SlotDraft | null>(slot);

  // Ресинк черновика — по фронту открытия: пока лист открыт, колесо
  // владеет значением, тики календаря его не перескакивают. Там же
  // взводится одноразовость выбора (pickedRef).
  const wasOpen = useRef(false);
  const pickedRef = useRef(false);
  const afterExit = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (slot && !wasOpen.current) {
      setDraft(slot);
      pickedRef.current = false;
    }
    wasOpen.current = slot != null;
  }, [slot]);

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

  const eventsOn = useFeatureOn("events");
  const pick = (kind: "work" | "event") => {
    // Одноразово: лист остаётся тапабельным 240 мс анимации закрытия, и
    // быстрый двойной тап открывал бы /book дважды (стопка экранов).
    if (!draft || pickedRef.current) return;
    pickedRef.current = true;
    haptics.tap();
    // /book — ПОСЛЕ ухода листа (блокер App Review). /book сразу
    // поднимает шторку клиента, а лист — отдельное окно `Modal`: пока он
    // уезжает, iOS второе окно не показывает, и невидимая шторка накрывала
    // форму — ни одного тапа, даже «Отмена». Сперва лист закрывается, дорога
    // открывается по `onExited`.
    const chosen = draft;
    afterExit.current = () => onPick(kind, chosen);
    onClose();
  };

  return (
    // АНАТОМИЯ ЛИСТА — КАНОНОМ: дата — шапкой через `title`
    // (она же зона жеста «потянуть вниз», как у всех листов), две дороги —
    // в `footer`, вне тела. Вид прежний: та же дата по центру 17/600, те же
    // две кнопки внизу, отступ под home-индикатор даёт сам футер.
    //
    // Дата выбрана самим тапом — по центру шапки, не в колесе. Времени в
    // шапке нет: его в 26pt показывает само колесо. Шапка никогда не
    // тонируется — проблема не в дате, а в часе.
    <BottomSheet
      padded={false}
      visible={slot != null}
      onClose={onClose}
      onExited={() => {
        const run = afterExit.current;
        afterExit.current = null;
        run?.();
      }}
      title={draft ? dateLabel(draft.date) : undefined}
      footer={
        draft ? (
          <View style={{ paddingHorizontal: FOOTER_SIDE, paddingTop: 6 }}>
          {/* ДВЕ ДОРОГИ СОЗДАНИЯ — ОДНА ГЕОМЕТРИЯ, РАЗНАЯ ЗАЛИВКА: событие тоже такое же,
                как клиент, но у «События» белый фон при той же кнопке.

                Сводится ГЕОМЕТРИЯ, а не вес: радиус 999 у «События» против
                10 у «Клиента» ставил пилюлю ровно над прямоугольником в одном
                листе. Радиус, высота (52) и кегль (17/600) одни на обе,
                расходится только заливка: «Клиент» — залитая главная дорога,
                «Событие» — второй вид на белом. Так лист называет главное, не
                заставляя читать подписи.

                Никогда не тонируются и не блокируются — вне часов запись
                разрешена. */}
            <View style={{ gap: 10 }}>
              {/* БЕЗ ТАРИФА «КЛИЕНТ» — СЕРЫЙ (закрытое тарифом
                  видно серым, тап поднимает плашку «Нужно изменить тариф» с
                  кнопкой «Тариф»). Оплата — на сайте, не через Apple. Тариф
                  решает не здесь: настоящий запрет — триггер
                  `enforce_plan_limits` в базе. */}
              {/* События выключены у компании (STORY-088) — второй дороги нет. */}
              {eventsOn && canEvent ? (
                <Button
                  label="Событие"
                  // Вид не зависит от тарифа: без тарифа «Клиент» серый,
                  // «Событие» — прежнее белое.
                  variant={canWork ? "secondary" : "primary"}
                  accessibilityHint="Откроет новое событие на выбранное время"
                  onPress={() => pick("event")}
                />
              ) : null}
              {!canWork ? null : (
                <TariffLocked locked={!canBookClients} beforeNudge={onClose}>
                  <Button
                    label="Клиент"
                    accessibilityHint="Откроет новую запись клиенту на выбранное время"
                    onPress={() => pick("work")}
                  />
                </TariffLocked>
              )}
            </View>
          </View>
        ) : undefined
      }
    >
      {draft ? (
        <View className="px-5">
          {/* Колесо только времени, минуты — по 5. */}
          <View className="flex-row items-center justify-center py-3">
            <TimeWheelPair
              hour={hourIdx}
              minute={minIdx * MINUTE_STEP}
              onChangeHour={setHour}
              onChangeMinute={setMin}
              labelPrefix="Время записи"
            />
          </View>
        </View>
      ) : null}
    </BottomSheet>
  );
}
