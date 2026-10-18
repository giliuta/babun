import { ScopeChips } from "@/components/ui/ScopeChips";
import { EmptyState } from "@/components/ui/EmptyState";
import { CalendarSkeleton } from "@/features/calendar/CalendarSkeleton";
import { FirstRunCalendarChoice } from "@/features/calendar/FirstRunCalendarChoice";
import { CalendarCreateSheet } from "@/features/calendar/CalendarCreateSheet";
import {
  closeFirstCalendarSheet,
  openFirstCalendarSheet,
  useFirstCalendarSheetOpen,
} from "@/features/calendar/first-calendar-sheet";
import type { CalendarController } from "./use-calendar-controller";

/** Body of the screen while this account has no own calendar to show. */
export function CalendarFirstRunGate({ c }: { c: CalendarController }) {
  const {
    chipItems, pendingChipId, pickCalendar, calendarsUnknown, ownAllHidden, teamsError,
    refetchTeams, role, onFirstCalendarCreated, onFirstCalendarExisting,
  } = c;
  const sheetOpen = useFirstCalendarSheetOpen();
  return (
    <>
      {/* ЛЕНТА ОСТАЁТСЯ И ЗДЕСЬ. Мастер, которому в этой компании ещё не
          выдали календарь, иначе оказывается в тупике: экран говорит
          «попросите владельца», а выйти нечем — свои календари живут в
          ленте, а ленты на этом экране не было. Поймано на себе 2026-09-12
          при первой же проверке перехода. Здесь в ленте стоят только чужие
          чипы (своих в этой компании нет) — и это ровно то, что человеку
          нужно: дорога к своему календарю. */}
      {chipItems.length > 0 ? (
        <ScopeChips
          items={chipItems}
          activeId={pendingChipId}
          onSelect={pickCalendar}
        />
      ) : null}
      {calendarsUnknown || ownAllHidden ? (
        // Скелет, а не голый спиннер: один экран — один язык ожидания.
        // Полосы чипов в скелете нет — команд ещё нет. Свои скрыты — идёт
        // переход в календарь другого аккаунта.
        <CalendarSkeleton mode="week" />
      ) : teamsError ? (
        <EmptyState
          state="error"
          fill
          title="Не удалось загрузить календарь"
          subtitle="Проверьте связь и попробуйте ещё раз"
          action={{ label: "Повторить", onPress: () => void refetchTeams() }}
        />
      ) : role !== "owner" ? (
        <EmptyState
          fill
          title={
            role === "master"
              ? "Календарь ещё не назначен"
              : "В аккаунте ещё нет календарей"
          }
          subtitle={
            role === "master"
              ? "Попросите владельца добавить вас в команду. После назначения заявки появятся здесь."
              : "Первый календарь создаёт владелец аккаунта."
          }
        />
      ) : (
        // ВЛАДЕЛЕЦ ПУСТОГО АККАУНТА: пустая сетка и одна кнопка внизу. Имя
        // календарю даёт он сам — шторкой с полем названия.
        <>
          <FirstRunCalendarChoice onCreate={openFirstCalendarSheet} />
          <CalendarCreateSheet
            first
            visible={sheetOpen}
            onClose={closeFirstCalendarSheet}
            onCreated={onFirstCalendarCreated}
            onExisting={onFirstCalendarExisting}
            teams={[]}
          />
        </>
      )}
    </>
  );
}
