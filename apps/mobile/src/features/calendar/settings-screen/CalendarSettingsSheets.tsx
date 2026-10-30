import { CalendarCreateSheet } from "@/features/calendar/CalendarCreateSheet";
import { CALENDAR_PRICE, euro } from "@/session/calendar-price";
import { CAN_PAY_HERE } from "@/lib/pay-here";
import { HourRangeSheet } from "@/features/calendar/HourRangeSheet";
import { TimezoneSheet } from "@/features/calendar/TimezoneSheet";
import { readViewportH } from "@/features/calendar/grid-memory";
import { TeamScheduleSheet } from "@/features/calendar/TeamScheduleSheet";
import { formatHm } from "@/features/calendar/window";
import type { CalendarSettingsState } from "./use-calendar-settings-screen";
import { useTeamName } from "@/session/team-name";

/** The screen's sheets: new calendar form, hours, timezone and the team
 *  schedule. */
export function CalendarSettingsSheets({ screen }: { screen: CalendarSettingsState }) {
  // Подпись шторки графика — имя команды правилом показа (`useTeamName`).
  const showTeamName = useTeamName();
  const {
    router,
    teams,
    team,
    rows,
    createOpen,
    setCreateOpen,
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
  return (
    <>
      <CalendarCreateSheet
        visible={createOpen}
        // У каждого календаря своя оплата: новый ведёт события сразу, а
        // клиенты и записи в нём — после его оплаты.
        note={
          CAN_PAY_HERE && !tariffForever
            ? `Клиенты и записи — после оплаты календаря, ${euro(CALENDAR_PRICE.monthly)} в месяц`
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
