import type { Href } from "expo-router";
import { CITY_CLEARED } from "@babun/shared/local/day-cities";
import {
  isDayOff,
  setDayOff,
  type TeamSchedule,
} from "@babun/shared/local/schedule";
import { DayLabelSheet } from "@/features/calendar/DayLabelSheet";
import {
  LABEL_FALLBACK_COLOR,
  resolveCalendarDayLabel,
} from "@/features/calendar/day-label";
import { hourLabel } from "@/features/calendar/setting-options";
import type { CalendarController } from "./use-calendar-controller";

/** Day label sheet of a date, with the team's day-off switch. */
export function CalendarDayLabelSheet({ c }: { c: CalendarController }) {
  const {
    cityPickerYmd, teamSchedule, activeTeamId, teamScheduleQuery, canManageBookings,
    activeActions, upsertSchedule, globalWork, toast, todayYmd, labelOptions, labelFor,
    setDayCityMut, setCityPickerYmd, cities, dayLabelsOn, role, router,
  } = c;
  return (
    <>
      {/* Метка дня — нижний лист (web parity CityPickerModal); тап по
          активной строке снимает метку. Целевую дату задаёт открывшая
          шапка (День — свой день, Неделя/Месяц — тапнутая дата). */}
      <DayLabelSheet
        visible={cityPickerYmd != null}
        // ВЫХОДНОЙ НА ЭТУ ДАТУ — date-override графика команды: только эта
        // дата, недельный график цел. Строки расписания может не быть вовсе —
        // тогда она РОЖДАЕТСЯ из действующих общих часов, ровно как в редакторе
        // графика, поэтому после сохранения на сетке ничего не «прыгает».
        // По ВСЕМУ графику (повторный аудит 03.10): воскресенье, выходное по
        // неделе, и день отпуска — тоже «Выходной», как «Вых» над датой.
        dayOff={cityPickerYmd ? isDayOff(teamSchedule, cityPickerYmd) : false}
        // Пока карта графиков не пришла, выходной не предлагаем: блоб собрался
        // бы из общих часов и заменил на сервере настоящий график команды.
        // Выходной — это ГРАФИК команды, не метка: сотруднику — только при
        // «График: Меняет», иначе тумблер всегда кончался «Не удалось
        // изменить день» (аудит 03.10).
        onToggleDayOff={
          activeTeamId &&
          cityPickerYmd &&
          !teamScheduleQuery.isPending &&
          (canManageBookings || activeActions.schedule === "write")
            ? (next) => {
                const ymd = cityPickerYmd;
                upsertSchedule.mutate(
                  {
                    teamId: activeTeamId,
                    // Правка ПОВЕРХ графика, а не готовый блоб: на сервер она
                    // ляжет поверх свежего графика команды, а не копии,
                    // загруженной когда-то на этот телефон (аудит 03.10).
                    schedule: (current) => {
                      const base: TeamSchedule = current ?? {
                        start: hourLabel(globalWork.start),
                        end: hourLabel(globalWork.end),
                        breaks: [],
                      };
                      // Правка на дату; снятый выходной с дня, выходного по
                      // неделе, делает его рабочим по общим часам
                      // (`setDayOff`).
                      return setDayOff(base, ymd, next);
                    },
                  },
                  {
                    onError: () =>
                      toast("Не удалось изменить день", "error"),
                  },
                );
              }
            : undefined
        }
        dateKey={cityPickerYmd ?? todayYmd}
        options={labelOptions}
        // Активная строка = разрешённая метка дня (labelFor: явная →
        // default_city, сентинел CITY_CLEARED = ничего) — web parity:
        // current={cityForDate(...)}, дефолт команды показан выбранным.
        selected={cityPickerYmd ? labelFor(cityPickerYmd)?.name ?? "" : ""}
        onPick={(name) => {
          if (activeTeamId && cityPickerYmd) {
            setDayCityMut.mutate({
              teamId: activeTeamId,
              date: cityPickerYmd,
              city: name,
            }, {
              onError: () => toast("Не удалось сохранить метку дня", "error"),
            });
          }
          setCityPickerYmd(null);
        }}
        onClear={() => {
          if (activeTeamId && cityPickerYmd) {
            // Сентинел, не пустая строка: "" удаляет override, и день тут же
            // перекрашивала бы метка по расписанию недели (web v693
            // handleCityReset). НО ТОЛЬКО КОГДА ТАКАЯ МЕТКА ЕСТЬ (повторный
            // аудит 03.10): снятая со «свободного» дня метка оставляла
            // «явно без метки» навсегда — и вторник, которому потом дали
            // метку по дням недели, этот день уже не получал. Нечему
            // перекрашивать — строка просто удаляется.
            const weekly = resolveCalendarDayLabel({
              dayCities: {},
              cities,
              teamId: activeTeamId,
              dateYmd: cityPickerYmd,
              todayYmd,
              fallbackColor: LABEL_FALLBACK_COLOR,
              off: !dayLabelsOn,
            });
            setDayCityMut.mutate({
              teamId: activeTeamId,
              date: cityPickerYmd,
              city: weekly ? CITY_CLEARED : "",
            }, {
              onError: () => toast("Не удалось снять метку дня", "error"),
            });
          }
          setCityPickerYmd(null);
        }}
        onClose={() => setCityPickerYmd(null)}
        // «Настроить» ведёт в БИБЛИОТЕКУ меток — туда, где пишут любое своё
        // слово и красят его (владелец 2026-08-17: «туда можно писать что
        // угодно, это всё метки»). Раньше кнопка открывала НАБОР меток команды
        // и вдобавок уводила в таб «Кабинет»: таб-бар переключался, и «назад»
        // выбрасывало не туда, откуда пришли (закон DS §5). Набор команды —
        // другой вопрос, он живёт в Кабинет → Команды.
        onSettings={
          role === "owner"
            ? () => {
                setCityPickerYmd(null);
                // Команда открытого календаря — параметром, как у шестерёнки:
                // без него экран брал выбор из памяти, а календарь после
                // перехода по ссылке показывал другую команду, и новая метка
                // уходила не туда (аудит 03.10).
                router.push({
                  pathname: "/calendar/labels",
                  params: activeTeamId ? { team: activeTeamId } : {},
                } as Href);
              }
            : undefined
        }
      />
    </>
  );
}
