import { memo, useState } from "react";
import { View } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import type { Appointment } from "@babun/shared/local/appointments";
import { formatYMD, parseYMD } from "@/features/appointments/helpers";
import { pluralize } from "@babun/shared/common/utils/pluralize";
import { useThemeColors } from "@/theme/colors";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { CalendarClock } from "lucide-react-native";
import { useBlockColors } from "@/features/calendar/status-colors";
import { ZoomableTimeGrid } from "@/features/calendar/zoom";
import { RAIL_W } from "@/features/calendar/grid-units";
import { PagedStrip, usePeriodPager } from "@/features/calendar/pager";
import {
  AllDayRow,
  allDayOf,
  hasAllDay,
  useAllDayBandH,
} from "./day-view/AllDayRow";
import { DEFAULT_END, DEFAULT_START, DEFAULT_STEP } from "./day-view/constants";
import { DayColumn } from "./day-view/DayColumn";
import { DayHeader } from "./day-view/DayHeader";
import { TimeRail } from "./day-view/TimeRail";
import type { FreeSlotRange, WorkBand } from "./day-view/types";

// The day grid's parts live in `day-view/`; this file stays the public entry.
export { RAIL_W } from "@/features/calendar/grid-units";
export { AllDayRow, allDayOf, hasAllDay, useAllDayBandH } from "./day-view/AllDayRow";
export { DayColumn } from "./day-view/DayColumn";
export { TimeRail } from "./day-view/TimeRail";
export type { FreeSlotRange, WorkBand } from "./day-view/types";

// Высота полосы шапки дат над сеткой (web DayColumn header h-[64px]) —
// страницы пейджера позиционируются абсолютно, полосе нужна явная высота.
export const HEADER_H = 64;

// ymd ± дни без TZ-сюрпризов (parseYMD → локальная полночь).
function addDaysYmd(ymd: string, days: number): string {
  const d = parseYMD(ymd);
  d.setDate(d.getDate() + days);
  return formatYMD(d);
}

// Single-day grid: hour rail + a live-paged day column (prev/cur/next dates
// ride the shared pager axis — swipe drags the neighbouring day in under the
// finger, web/Bumpix-style). Header pages in lockstep with the column.
//
// `memo` — по той же причине, что у WeekView: пропсы экран держит стабильными.
export const DayView = memo(function DayView({
  dateYmd,
  apptsFor,
  todayYmd,
  clientName,
  serviceLabel,
  addressFor,
  teamColorFor,
  offLabelColorFor,
  onEdit,
  onMenu,
  onCreateAt,
  onSlotLongPress,
  editingId = null,
  onReschedule,
  canReschedule,
  onCommitPage,
  startHour = DEFAULT_START,
  endHour = DEFAULT_END,
  stepMinutes = DEFAULT_STEP,
  hourH,
  hourHSv,
  onZoom,
  workStartHour,
  workEndHour,
  workBandFor,
  freeSlotsFor,
  labelTintFor,
  bufferMinutes,
  nowMinutes,
  scrollToHour,
  labelFor,
  onDayLabelTap,
}: {
  /** Центральная (закоммиченная) дата. Соседние страницы — ±1 день. */
  dateYmd: string;
  /** Записи по дате — страницы пейджера сами берут свой день. */
  apptsFor: (dateYmd: string) => Appointment[];
  /** Бизнес-сегодня (now-line и заливка даты по страницам). */
  todayYmd: string;
  clientName: (a: Appointment) => string;
  serviceLabel?: (a: Appointment) => string | null;
  /** Куда ехать — четвёртая строка блока: снимок адреса записи, иначе адрес
   *  клиента. null — не показывать. */
  addressFor?: (a: Appointment) => string | null;
  teamColorFor?: (a: Appointment) => string | null;
  /** Цвет чужой метки записи — окантовка блока (см. DayColumn). */
  offLabelColorFor?: (a: Appointment) => string | null;
  onEdit: (a: Appointment) => void;
  /** Долгое нажатие без движения по блоку — контекстное меню записи. */
  onMenu?: (a: Appointment) => void;
  onCreateAt?: (dateYmd: string, timeStart: string) => void;
  /** Долгое нажатие по свободному времени — быстрое меню («Перерыв»,
   *  «Метка дня») без формы записи. */
  onSlotLongPress?: (dateYmd: string, timeStart: string) => void;
  /** Запись в режиме правки («Двигать и растягивать» из меню записи): только
   *  у неё палец двигает и тянет за края, и только пока режим включён. */
  editingId?: string | null;
  onReschedule?: (
    a: Appointment,
    newStart: string,
    newEnd: string,
    date?: string,
  ) => void;
  /** Per-record mutation guard (shared team events are creator-only). */
  canReschedule?: (a: Appointment) => boolean;
  /** Палец долистал страницу: родитель сдвигает день на ±1. */
  onCommitPage: (dir: 1 | -1) => void;
  startHour?: number;
  endHour?: number;
  stepMinutes?: number;
  /** Committed pixels-per-hour (see ZoomableTimeGrid). */
  hourH: number;
  /** Live pixels-per-hour shared value (see ZoomableTimeGrid). */
  hourHSv: SharedValue<number>;
  /** Pinch-zoom commit — new pixels-per-hour, once per gesture. */
  onZoom?: (next: number) => void;
  workStartHour?: number;
  workEndHour?: number;
  /** Per-date work band from team_schedules (see DayColumn.workBand). */
  workBandFor?: (dateYmd: string) => WorkBand | null | undefined;
  /** Свободные слоты по дате — режим «Записать» (см. DayColumn.freeSlots).
   *  День обязан показывать те же кубики, что и Неделя: без этого пропа
   *  плашка «Выберите зелёное время» висела над сеткой без единого кубика. */
  freeSlotsFor?: (dateYmd: string) => readonly FreeSlotRange[] | undefined;
  /** Per-date day-label colour → light column wash; undefined resolver
   *  when team.tint_days_by_label is off (see DayColumn.tintColor). */
  labelTintFor?: (dateYmd: string) => string | null;
  /** Buffer after each appointment (team ?? global), minutes. */
  bufferMinutes?: number;
  nowMinutes?: number | null;
  /** Час, на котором календарь открывается: начало графика команды в этот
   *  день (см. `deriveScrollHour`). */
  scrollToHour?: number;
  /** Метка дня по дате (undefined — у команды нет меток, шапки чистые). */
  labelFor?: (dateYmd: string) => { name: string; color: string } | null;
  onDayLabelTap?: () => void;
}) {
  const t = useThemeColors();
  const pager = usePeriodPager({ periodKey: dateYmd, onCommit: onCommitPage });
  const dateAt = (off: -1 | 0 | 1) => addDaysYmd(dateYmd, off);
  // «+N» полосы «весь день» в Дне — список всех событий дня (повторный аудит
  // 03.10): Неделя уводит «+N» в День, а в самом Дне ему вести было некуда, и
  // спрятанные события дня были недостижимы.
  const [allDayList, setAllDayList] = useState<Appointment[] | null>(null);
  const allDayColors = useBlockColors(teamColorFor);
  const bandH = useAllDayBandH();
  // Условие по ВСЕМ трём страницам пейджера: иначе чип выскакивал бы уже после
  // доводки свайпа, а высота полосы менялась бы под пальцем.
  const showBand = ([-1, 0, 1] as const).some((off) =>
    hasAllDay(apptsFor(dateAt(off))),
  );

  return (
    <View style={{ flex: 1 }}>
      {/* Полоса шапки — страницы дат едут в локстепе с колонками; линия
          сетки живёт на обёртке и не скользит. Граница волосяная — шапка
          читается продолжением сетки (как в Неделе). */}
      <View
        style={{
          flexDirection: "row",
          borderBottomWidth: 1,
          borderBottomColor: `${t.ink}1a`,
        }}
      >
        <View style={{ width: RAIL_W, backgroundColor: t.surface }} />
        <PagedStrip
          pager={pager}
          style={{ height: HEADER_H }}
          renderPage={(off) => {
            const d = dateAt(off);
            return (
              <DayHeader
                dateYmd={d}
                isToday={d === todayYmd}
                isPast={d < todayYmd}
                label={labelFor?.(d) ?? null}
                dayOff={workBandFor?.(d) === null}
                onLabelTap={off === 0 ? onDayLabelTap : undefined}
              />
            );
          }}
        />
      </View>
      {showBand ? (
        <View
          style={{
            flexDirection: "row",
            borderBottomWidth: 1,
            borderBottomColor: `${t.ink}1a`,
          }}
        >
          {/* Рельс слева пустой: подпись «Весь день» — ровно тот шум, который
              из продукта убирают, и 13pt в 48pt рельса не влезает. */}
          <View style={{ width: RAIL_W, backgroundColor: t.surface }} />
          <PagedStrip
            pager={pager}
            style={{ height: bandH }}
            renderPage={(off) => (
              <AllDayRow
                appointments={allDayOf(apptsFor(dateAt(off)))}
                clientName={clientName}
                teamColorFor={teamColorFor}
                onEdit={onEdit}
                onMenu={onMenu}
                onOverflow={() => setAllDayList(allDayOf(apptsFor(dateAt(off))))}
              />
            )}
          />
        </View>
      ) : null}
      <ZoomableTimeGrid
        view="day"
        hourHSv={hourHSv}
        scrollLocked={!!editingId}
        onZoom={onZoom}
        startHour={startHour}
        endHour={endHour}
        scrollToHour={scrollToHour}
        pageGesture={pager.pan}
      >
        <TimeRail
          startHour={startHour}
          endHour={endHour}
          nowMinutes={dateYmd === todayYmd ? nowMinutes : null}
        />
        <PagedStrip
          pager={pager}
          renderPage={(off) => {
            const d = dateAt(off);
            return (
              <DayColumn
                dateYmd={d}
                appointments={apptsFor(d)}
                clientName={clientName}
                serviceLabel={serviceLabel}
                addressFor={addressFor}
                teamColorFor={teamColorFor}
                offLabelColorFor={offLabelColorFor}
                isToday={d === todayYmd}
                todayYmd={todayYmd}
                onEdit={onEdit}
                onMenu={onMenu}
                onCreateAt={onCreateAt}
                onSlotLongPress={onSlotLongPress}
                editingId={editingId}
                onReschedule={onReschedule}
                canReschedule={canReschedule}
                startHour={startHour}
                endHour={endHour}
                stepMinutes={stepMinutes}
                hourH={hourH}
                workStartHour={workStartHour}
                workEndHour={workEndHour}
                workBand={workBandFor?.(d)}
                freeSlots={freeSlotsFor?.(d)}
                tintColor={labelTintFor?.(d) ?? null}
                bufferMinutes={bufferMinutes}
                // «Сейчас» — только странице сегодня: соседние страницы его не
                // читают, а тик раз в минуту перерисовывал бы и их.
                nowMinutes={d === todayYmd ? nowMinutes : null}
              />
            );
          }}
        />
      </ZoomableTimeGrid>
      <PickerSheet
        visible={allDayList != null}
        title={allDayList ? `Весь день · ${pluralize(allDayList.length, "событие", "события", "событий")}` : ""}
        onClose={() => setAllDayList(null)}
        items={(allDayList ?? []).map((a) => ({
          id: a.id,
          label: clientName(a) || a.comment || "Событие",
          icon: CalendarClock,
          color: allDayColors(a).solid,
          onPress: () => onEdit(a),
        }))}
      />
    </View>
  );
});
