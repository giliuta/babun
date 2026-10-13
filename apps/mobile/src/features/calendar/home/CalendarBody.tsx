import { View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { EmptyState } from "@/components/ui/EmptyState";
import { isColdOfflineCacheMissError } from "@babun/shared/sync";
import { formatYMD } from "@/features/appointments/helpers";
import { AgendaView } from "@/features/calendar/AgendaView";
import { CalendarSkeleton } from "@/features/calendar/CalendarSkeleton";
import { DayFinanceFooter } from "@/features/calendar/DayFinanceFooter";
import { DayView } from "@/features/calendar/DayView";
import { MonthView } from "@/features/calendar/MonthView";
import { PagedStrip } from "@/features/calendar/pager";
import { WeekView } from "@/features/calendar/WeekView";
import type { CalendarController } from "./use-calendar-controller";

/** The calendar itself: skeleton, load error, or the List, Week, Day or
 *  Month view with its money footer. */
export function CalendarBody({ c }: { c: CalendarController }) {
  const {
    calendarLoading, mode, calendarError, onRefresh, agendaSections, addressFor,
    todayYmd, tomorrowYmd, clientName, serviceSummaryFor, openEdit, openActionMenu,
    labelFor, offLabelFor, teamColorFor, t, situationFor, overdueFor, isCrew,
    amountVisible, pull, canCreateOnGrid, nowMinutes, bookAt, canManageBookings,
    activeActions, weekDays, apptsFor, now, offLabelColorFor, createAtGrid, moving,
    editingApt, canSlotMenu, pickClientId, slotMenuGrid, onMenuGrid, pickDay,
    onPickLabelDay, onCommitWeekPage, gridProps, showDayFinance, financeWeekAppts,
    activeTeamId, seesIncome, seesExpense, setFinModalYmd, dayYmd, onDayLabelTap,
    onCommitDayPage, day, financeFor, monthPager, monthPages, visibleAppts,
    financeAppts, nowHmBusiness, workBandFor, holeFor, openWeekFromMonth,
  } = c;
  return (
    <>
      {calendarLoading ? (
        // mode известен синхронно (MMKV) — скелет обязан обещать ту же
        // геометрию, что придёт после загрузки (день ≠ 7 колонок недели,
        // месяц ≠ сетка часов).
        <CalendarSkeleton mode={mode} />
      ) : calendarError ? (
        // Тот же шаблон, что у ошибки команд выше, и обязательно с
        // «Повторить»: без кнопки экран был тупиком — выйти можно было
        // только убив приложение. Сырой error.message на экран не выводим
        // (он для Sentry, а не для диспетчера на объекте).
        <EmptyState
          state="error"
          fill
          title={
            isColdOfflineCacheMissError(calendarError)
              ? "Календарь недоступен офлайн"
              : "Не удалось загрузить календарь"
          }
          subtitle={
            isColdOfflineCacheMissError(calendarError)
              ? "На этом устройстве ещё нет сохранённой копии. Подключитесь к интернету, чтобы увидеть занятое время и создавать записи."
              : "Проверьте связь и попробуйте ещё раз"
          }
          action={{ label: "Повторить", onPress: () => void onRefresh() }}
        />
      ) : mode === "agenda" ? (
        <AgendaView
          sections={agendaSections}
          addressFor={addressFor}
          todayYmd={todayYmd}
          tomorrowYmd={tomorrowYmd}
          clientName={clientName}
          serviceSummary={serviceSummaryFor}
          onEdit={openEdit}
          onMenu={openActionMenu}
          labelFor={labelFor}
          offLabelFor={offLabelFor}
          // ВЫБРАННЫЙ РУКОЙ ЦВЕТ СИЛЬНЕЕ ПРАВИЛА — так же, как в сетке
          // (`useBlockColors` спрашивает `color_override` первым). Без этого
          // событие с выбранным цветом красилось в сетке выбранным, а в ленте
          // цветом команды: один предмет двух цветов.
          hueFor={(a) => a.color_override || teamColorFor(a) || t.accent}
          situationFor={situationFor}
          overdueFor={overdueFor}
          showAmounts={isCrew ? amountVisible : true}
          refreshing={pull.refreshing}
          onRefresh={pull.onRefresh}
          onCreate={
            canCreateOnGrid
              ? () => {
                  // Ближайшее получасовое время сегодня, а не 10:00, которое
                  // днём уже прошло.
                  const next = Math.min(23 * 60 + 30, Math.ceil((nowMinutes + 1) / 30) * 30);
                  bookAt({
                    date: todayYmd,
                    time_start: `${String(Math.floor(next / 60)).padStart(2, "0")}:${String(next % 60).padStart(2, "0")}`,
                    // Сотруднику с одними «Событиями» — событие: запись ему не
                    // открыта, и кнопка всегда кончалась отказом (аудит 03.10).
                    kind: canManageBookings || activeActions.create ? "work" : "event",
                  });
                }
              : undefined
          }
        />
      ) : mode === "week" ? (
        <>
          <View className="flex-1">
            <WeekView
              days={weekDays}
              apptsFor={apptsFor}
              today={now}
              labelFor={labelFor}
              offLabelColorFor={offLabelColorFor}
              // «Свободное перемещение» заканчивается тапом по сетке — и у
              // того, кому «Новые записи» закрыты (аудит 03.10).
              onCreateAt={canCreateOnGrid || moving || editingApt ? createAtGrid : undefined}
              onSlotLongPress={
                !canSlotMenu || moving || editingApt || pickClientId ? undefined : slotMenuGrid
              }
              editingId={editingApt?.id ?? null}
              onMenu={onMenuGrid}
              onPickDay={pickDay}
              onPickLabelDay={onPickLabelDay}
              onCommitPage={onCommitWeekPage}
              {...gridProps}
            />
          </View>
          {showDayFinance ? (
            <DayFinanceFooter
              days={weekDays}
              appointments={financeWeekAppts}
              teamId={activeTeamId}
              todayYmd={todayYmd}
              showIncome={seesIncome}
              showExpense={seesExpense}
              onTapDay={(d) => setFinModalYmd(formatYMD(d))}
            />
          ) : null}
        </>
      ) : mode === "day" ? (
        <>
          {/* ПОЛОСЫ-СВОДКИ ДНЯ ЗДЕСЬ НЕТ (владелец 2026-08-15). «N записей ·
              €X · N без оплаты» пересказывала то, что и так стоит на экране:
              записи видно в сетке, деньги дня — в футере под ней, долги — на
              «Финансах». Ряд пиллов только отжимал сетку вниз. */}
          <View className="flex-1">
            <DayView
              dateYmd={dayYmd}
              apptsFor={apptsFor}
              todayYmd={todayYmd}
              labelFor={labelFor}
              offLabelColorFor={offLabelColorFor}
              onDayLabelTap={onDayLabelTap}
              onMenu={onMenuGrid}
              // «Свободное перемещение» заканчивается тапом по сетке — и у
              // того, кому «Новые записи» закрыты (аудит 03.10).
              onCreateAt={canCreateOnGrid || moving || editingApt ? createAtGrid : undefined}
              onSlotLongPress={
                !canSlotMenu || moving || editingApt || pickClientId ? undefined : slotMenuGrid
              }
              editingId={editingApt?.id ?? null}
              onCommitPage={onCommitDayPage}
              {...gridProps}
            />
          </View>
          {showDayFinance ? (
            <DayFinanceFooter
              days={[day]}
              appointments={financeFor(dayYmd)}
              teamId={activeTeamId}
              todayYmd={todayYmd}
              showIncome={seesIncome}
              showExpense={seesExpense}
              onTapDay={(d) => setFinModalYmd(formatYMD(d))}
            />
          ) : null}
        </>
      ) : (
        <GestureDetector gesture={monthPager.pan}>
          <View className="flex-1">
            <PagedStrip
              pager={monthPager}
              renderPage={(off) => (
                <MonthView
                  month={monthPages[off + 1]}
                  appointments={visibleAppts}
                  financeAppointments={financeAppts}
                  teamId={activeTeamId}
                  todayYmd={todayYmd}
                  nowHm={nowHmBusiness}
                  showFinance={seesIncome && seesExpense}
                  labelFor={labelFor}
                  isDayOff={(ymd) => workBandFor?.(ymd) === null}
                  holeFor={holeFor}
                  onPickDay={openWeekFromMonth}
                  onPickLabelDay={onPickLabelDay}
                />
              )}
            />
          </View>
        </GestureDetector>
      )}
    </>
  );
}
