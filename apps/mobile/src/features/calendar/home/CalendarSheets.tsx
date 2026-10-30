import { ColorSheet } from "@/features/appointments/BookingSheets";
import { humanDayTitle } from "@/features/appointments/helpers";
import { ActionMenuSheet } from "@/components/blocks/ActionMenuSheet";
import { BookSlotSheet } from "@/features/calendar/BookSlotSheet";
import { DayFinanceSheet } from "@/features/calendar/DayFinanceSheet";
import { SelfReminderSheet } from "@/features/calendar/SelfReminderSheet";
import { isCalendarEvent } from "@/features/calendar/event-access";
import { getSelfReminder } from "@/features/calendar/reminders";
import { serverReason } from "@/features/calendar/server-reason";
import { SmsSendSheet } from "@/features/sms/SmsSendSheet";
import { appointmentSmsVars } from "@/features/sms/client-sms-vars";
import { haptics } from "@/lib/haptics";
import type { CalendarController } from "./use-calendar-controller";

/** Bottom sheets opened from the grid: day money, new record, record menu,
 *  SMS, reminder and colour. */
export function CalendarSheets({ c }: { c: CalendarController }) {
  const {
    canViewCompanyFinance, finModalYmd, financeFor, activeTeamId, todayYmd,
    nowHmBusiness, setFinModalYmd, openEdit, findFinanceRecord, slotDraft,
    activeActions, setSlotDraft, bookAt, sheetMenu, setSheetMenu, smsApt, clients,
    smsOpen, teams, companyName, canManageBookings, setSmsOpen, reminderFor,
    pickReminderFor, setReminderFor, recolor, setRecolor, teamColorFor, updateAppt,
    toast, recordRoute,
  } = c;
  return (
    <>
      {/* Разбор финансов дня — лист снизу по тапу на футер Доход/Расход
          (владелец 2026-09-07: «чтобы снизу вверх поднималась плашка»). */}
      {canViewCompanyFinance ? (
        <DayFinanceSheet
          dateYmd={finModalYmd}
          appointments={finModalYmd ? financeFor(finModalYmd) : []}
          teamId={activeTeamId}
          businessToday={todayYmd}
          nowHm={nowHmBusiness}
          onClose={() => setFinModalYmd(null)}
          onEditAppointment={openEdit}
          // После формы операции человек возвращается в разбор того же дня.
          onReopen={(ymd) => setFinModalYmd(ymd)}
          findRecord={findFinanceRecord}
        />
      ) : null}

      {/* Тап по пустому слоту — лист «когда и кого записать»: барабан
          даты/времени (шаг 5 минут) + две дороги создания. /book
          открывается уже с выбранными временем и типом. */}
      <BookSlotSheet
        slot={slotDraft}
        canWork={activeActions.create}
        canEvent={activeActions.events === "write"}
        onClose={() => setSlotDraft(null)}
        onPick={(kind, s) => {
          setSlotDraft(null);
          bookAt({ date: s.date, time_start: s.time, kind });
        }}
      />


      <ActionMenuSheet menu={sheetMenu} onClose={() => setSheetMenu(null)} />
      {smsApt ? (() => {
        const smsClient = smsApt.client_id ? clients.find((c) => c.id === smsApt.client_id) : undefined;
        return (
          <SmsSendSheet
            visible={smsOpen}
            context={{
              appointmentId: smsApt.id,
              clientId: smsApt.client_id ?? null,
              teamId: smsApt.team_id ?? null,
              optOut: smsClient?.sms_opt_out === true,
              vars: appointmentSmsVars({
                client: smsClient ?? null,
                appointment: smsApt,
                teamName: teams.find((tm) => tm.id === smsApt.team_id)?.name ?? null,
                address: smsApt.address || smsClient?.address || null,
                company: companyName,
                showMoney: canManageBookings,
              }),
            }}
            phone={(smsClient?.phone_e164 || smsClient?.phone || "").trim() || null}
            onClose={() => setSmsOpen(false)}
          />
        );
      })() : null}
      {recordRoute.sheet}
      <SelfReminderSheet
        visible={reminderFor != null}
        value={reminderFor ? getSelfReminder(reminderFor.id) : null}
        subtitle={
          reminderFor ? `${humanDayTitle(reminderFor.date)}, ${reminderFor.time_start}` : undefined
        }
        onPick={pickReminderFor}
        onClose={() => setReminderFor(null)}
      />
      <ColorSheet
        visible={recolor != null}
        onClose={() => setRecolor(null)}
        commitOnPick
        isEvent={recolor != null && isCalendarEvent(recolor)}
        value={recolor?.color_override ?? null}
        // Образец «Автоматически» — цвет, который запись получит БЕЗ ручного:
        // то же правило, что красит сетку, только с пустым override.
        autoColor={
          recolor ? teamColorFor({ ...recolor, color_override: null }) : null
        }
        onPick={(c) => {
          const apt = recolor;
          setRecolor(null);
          if (!apt) return;
          const prev = apt.color_override ?? null;
          if ((c ?? null) === prev) return;
          haptics.tap();
          updateAppt.mutate(
            { id: apt.id, patch: { color_override: c } },
            {
              onSuccess: () =>
                toast(c ? "Цвет изменён" : "Цвет — автоматически", "success", {
                  label: "Отменить",
                  onPress: () =>
                    updateAppt.mutate(
                      { id: apt.id, patch: { color_override: prev } },
                      {
                        onError: () =>
                          toast("Не удалось вернуть цвет", "error"),
                      },
                    ),
                }),
              onError: (e) =>
                toast(serverReason(e) ?? "Не удалось изменить цвет", "error"),
            },
          );
        }}
      />
    </>
  );
}
