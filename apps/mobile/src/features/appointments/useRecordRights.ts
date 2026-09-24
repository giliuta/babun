import { useCallback } from "react";
import { useAccessBlocks, useMyAccess } from "@/features/access/queries";
import { useCurrentRole } from "@/features/settings/tenant";
import {
  calendarActions,
  recordBlocks,
  type CalendarActions,
  type RecordBlocks,
} from "./record-blocks";

// Хуки отдельно от правила: `record-blocks.ts` остаётся чистым, чтобы его
// поднимал тестовый раннер. Зеркало «его глазами» приходит само: в нём
// `useCurrentRole` и `useMyAccess` отвечают за сотрудника.

/** Блоки страницы записи в календаре `teamId`. */
export function useRecordBlocks(teamId: string | null): RecordBlocks {
  const role = useCurrentRole().data;
  const map = useMyAccess().data;
  const registry = useAccessBlocks().data;
  return recordBlocks({ role, map, registry, teamId });
}

/** Действия с записями календаря `teamId` — для сетки, меню и «+». */
export function useCalendarActions(teamId: string | null): CalendarActions {
  const role = useCurrentRole().data;
  const map = useMyAccess().data;
  const registry = useAccessBlocks().data;
  return calendarActions({ role, map, registry, teamId });
}

/** Читатель действий по любому календарю — для сетки, где на экране
 *  записи нескольких команд сразу. */
export function useCalendarActionsReader(): (teamId: string | null) => CalendarActions {
  const role = useCurrentRole().data;
  const map = useMyAccess().data;
  const registry = useAccessBlocks().data;
  // Стабильная ссылка: читатель уходит в мемо сетки, и новая функция на
  // каждый рендер перерисовывала бы все страницы пейджера.
  return useCallback(
    (teamId: string | null) => calendarActions({ role, map, registry, teamId }),
    [role, map, registry],
  );
}
