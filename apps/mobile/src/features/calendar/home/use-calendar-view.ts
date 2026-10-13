import { useEffect, useMemo, useRef, useState } from "react";
import { getStorage } from "@babun/shared/storage";
import {
  readTenantPref,
  tenantPrefKey,
  writeTenantPref,
} from "@/lib/tenant-prefs";
import { type CalMode } from "@/features/calendar/ViewModeDropdown";
import { startOfDay, startOfMonth } from "./dates";
import { CAL_MODE_DEVICE_KEY, CAL_VIEW_LEGACY_KEY } from "./view-prefs";
import type { CalendarRoute } from "./use-calendar-route";

type UseCalendarViewDeps =
  Pick<CalendarRoute, "tenantId">;

/** What the calendar shows: view mode, anchor day and the chosen calendar,
 *  with their persistence. */
export function useCalendarView(deps: UseCalendarViewDeps) {
  const { tenantId } = deps;
  // Вид и команда переживают перезапуск (MMKV): владелец двух команд в
  // «Неделе» не должен каждый старт возвращаться в «День» первой команды.
  // Дата сознательно НЕ персистится — холодный старт всегда «сегодня».
  // Дефолт для нового пользователя — «Неделя» (стандарт по решению
  // владельца 2026-07-13; дальше вид запоминается за пользователем).
  const [mode, setMode] = useState<CalMode>(() => {
    let saved: CalMode | undefined;
    try {
      const storage = getStorage();
      saved =
        storage.get<{ mode?: CalMode }>(CAL_MODE_DEVICE_KEY)?.mode ??
        // Второе поколение: вчерашняя настройка под компанией.
        (tenantId
          ? storage.get<{ mode?: CalMode }>(
              tenantPrefKey("calendar.view", tenantId),
            )?.mode
          : undefined) ??
        // Первое поколение: голый ключ до правки 12.09.
        storage.get<{ mode?: CalMode }>(CAL_VIEW_LEGACY_KEY)?.mode;
    } catch {
      // MMKV умеет бросить, пока Keychain заперт на прогреве iOS. Вид —
      // удобство, а не данные: молча отдаём умолчание.
      saved = undefined;
    }
    return saved === "day" || saved === "month" || saved === "agenda"
      ? saved
      : "week";
  });
  // ЕДИНЫЙ якорь даты для всех видов (web parity: один currentMonday).
  // Раньше было два стейта (day + cursor месяца) — они рассинхронивались:
  // свайп месяца двигал только cursor, выбор дня — только day, и переход
  // Месяц↔День «прыгал» на устаревшую дату. Месяц теперь ДЕРИВАТ от day.
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const monthAnchor = useMemo(() => startOfMonth(day), [day]);
  // Web parity (Header.tsx): exactly one team calendar is active at a time —
  // no «all teams» view. `teamChoice` remembers the user's pick; the derived
  // `activeTeamId` falls back to the first team until they choose and
  // re-anchors if the chosen team is deleted / deactivated.
  const [teamChoice, setTeamChoice] = useState<string | null>(
    () =>
      (tenantId
        ? readTenantPref<{ teamId?: string | null }>(
            "calendar.view",
            tenantId,
            CAL_VIEW_LEGACY_KEY,
          )?.teamId
        : null) ?? null,
  );
  // ПЕРСИСТ ТОЛЬКО ПО ВОЛЕ ЧЕЛОВЕКА. Раньше вид и активная команда писались
  // в MMKV эффектом на ЛЮБОЕ изменение — включая переходы ПО ПАРАМЕТРАМ
  // («Прошлый визит» с карточки, вход мастера, напоминание). Человек открывал
  // один визит, а календарь навсегда переключался на «День» и на чужую
  // команду. Теперь параметрический переход показывает нужное, но
  // предпочтения не трогает.
  const prefRef = useRef({ mode, teamId: teamChoice });
  const rememberView = (next: { mode?: CalMode; teamId?: string | null }) => {
    prefRef.current = { ...prefRef.current, ...next };
    if (next.mode !== undefined) {
      try {
        getStorage().set(CAL_MODE_DEVICE_KEY, { mode: prefRef.current.mode });
      } catch {
        // см. чтение режима выше
      }
    }
    if (next.teamId !== undefined && tenantId) {
      // Пишется только команда: режим уехал на устройство, и держать его
      // копию здесь значило бы завести второй источник правды.
      writeTenantPref("calendar.view", tenantId, {
        teamId: prefRef.current.teamId,
      });
    }
  };
  // Стабильная ссылка для колбэков с пустыми зависимостями.
  const rememberViewRef = useRef(rememberView);
  rememberViewRef.current = rememberView;

  // ПЕРЕСЕВ ПРИ СМЕНЕ КОМПАНИИ — ТОЛЬКО ТОГО, ЧТО ПРИНАДЛЕЖИТ КОМПАНИИ.
  // Переход в другую компанию этот экран НЕ размонтирует, поэтому выбор
  // календаря надо перечитать: без этого человек
  // увидел бы в новой базе команду прежней, а первое же действие записало бы
  // её туда как «свою».
  //
  // РЕЖИМ ЗДЕСЬ НЕ ТРОГАЕТСЯ НАМЕРЕННО. Владелец 2026-09-13: «один на все
  // компании» — переключил базу, а День/Неделя/Месяц остались теми же. Вчера
  // этот пересев перечитывал и режим; ровно это и было ошибкой.
  //
  // Старый ключ здесь не передаётся: он принадлежал прежней компании и был
  // забран при монтировании. Отдать его второй — приписать ей чужую привычку.
  const seededTenantRef = useRef(tenantId);
  useEffect(() => {
    if (seededTenantRef.current === tenantId) return;
    seededTenantRef.current = tenantId;
    const nextTeam =
      (tenantId
        ? readTenantPref<{ teamId?: string | null }>("calendar.view", tenantId)
            ?.teamId
        : null) ?? null;
    prefRef.current = { ...prefRef.current, teamId: nextTeam };
    setTeamChoice(nextTeam);
  }, [tenantId]);

  return {
    mode, setMode, day, setDay, monthAnchor, teamChoice, setTeamChoice, rememberView,
    rememberViewRef,
  };
}

export type CalendarView = ReturnType<typeof useCalendarView>;
