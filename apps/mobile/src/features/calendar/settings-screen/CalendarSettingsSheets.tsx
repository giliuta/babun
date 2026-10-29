import { CalendarCreateSheet } from "@/features/calendar/CalendarCreateSheet";
import { CalendarOfferSheet } from "@/features/tariffs/CalendarOfferSheet";
import { useLiveCalendarCount } from "@/features/tariffs/use-live-calendars";
import { CALENDAR_PRICE, euro } from "@/session/calendar-price";
import { CAN_PAY_HERE } from "@/lib/pay-here";
import { HourRangeSheet } from "@/features/calendar/HourRangeSheet";
import { TimezoneSheet } from "@/features/calendar/TimezoneSheet";
import { readViewportH } from "@/features/calendar/grid-memory";
import { TeamScheduleSheet } from "@/features/calendar/TeamScheduleSheet";
import { formatHm } from "@/features/calendar/window";
import type { CalendarSettingsState } from "./use-calendar-settings-screen";
import { useTeamName } from "@/session/team-name";

/** The screen's sheets: new calendar offer and form, hours, timezone and
 *  the team schedule. */
export function CalendarSettingsSheets({ screen }: { screen: CalendarSettingsState }) {
  // Подпись шторки графика — имя команды правилом показа (`useTeamName`).
  const showTeamName = useTeamName();
  const {
    router,
    teams,
    team,
    rows,
    offerOpen,
    setOfferOpen,
    createOpen,
    setCreateOpen,
    tariffPaid,
    tariffForever,
    picker,
    setPicker,
    view,
    gridZoom,
    applyZoom,
    patchTeam,
    timezone,
    scheduleOpen,
    setScheduleOpen,
  } = screen;
  // Предложение «Новый календарь» называет сумму — значит, считает те же
  // платные календари (с работой), что «Тариф» и Stripe, а не все живые.
  const paidCalendars = useLiveCalendarCount();
  return (
    <>
      <CalendarOfferSheet
        visible={offerOpen}
        calendars={paidCalendars ?? 0}
        onClose={() => setOfferOpen(false)}
        onUnlocked={() => setCreateOpen(true)}
      />
      <CalendarCreateSheet
        visible={createOpen}
        // Подписка уже есть — календарь в ней со следующего платежа.
        note={
          CAN_PAY_HERE && tariffPaid && !tariffForever
            ? `+${euro(CALENDAR_PRICE.monthly)} в месяц со следующего платежа`
            : undefined
        }
        onClose={() => setCreateOpen(false)}
        teams={teams}
        onCreated={(created) => router.setParams({ team: created.id })}
      />

      {/* Часы календаря — нижним листом «С … До …» (как время в финансах): сегмент С|До, список часов, «Применить». */}
      <HourRangeSheet
        visible={picker === "view" || picker === "zoom"}
        title={picker === "zoom" ? "Масштаб" : "Часы календаря"}
        value={view}
        hoursEditable={picker === "view" && rows.hoursEdit}
        zoom={{ initial: gridZoom, vh: readViewportH("week"), onApply: applyZoom }}
        onClose={() => setPicker(null)}
        // ПИШЕТСЯ В КОМАНДУ, А НЕ В КОМПАНИЮ: часы календаря принадлежат этому
        // календарю. Текст «ЧЧ:ММ» в `teams.calendar_window_*` несёт и минуты,
        // поэтому второй пары колонок под них не нужно.
        onApply={(v) =>
          patchTeam({
            calendar_window_start: formatHm({
              hour: v.start,
              minute: v.startMinute,
            }),
            calendar_window_end: formatHm({ hour: v.end, minute: v.endMinute }),
          })
        }
      />
      <TimezoneSheet
        visible={picker === "tz"}
        onClose={() => setPicker(null)}
        value={timezone}
        onApply={(zone) => patchTeam({ timezone: zone })}
      />
      <TeamScheduleSheet
        visible={scheduleOpen}
        teamId={team?.id}
        teamName={team ? showTeamName(team.name) : undefined}
        onClose={() => setScheduleOpen(false)}
      />
    </>
  );
}
