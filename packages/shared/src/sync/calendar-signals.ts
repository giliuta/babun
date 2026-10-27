// Сигналы календаря для сотрудника — живое обновление без доступа к таблице.
//
// Владелец слушает `postgres_changes` на `appointments` (`realtime.ts`).
// Сотруднику таблица закрыта: Realtime отдаёт такое событие только тому, кому
// строку показывает политика чтения, а событие несёт строку целиком — мимо
// масок двери `list_master_appointments_safe`. Поэтому для сотрудника сервер
// шлёт в приватную тему `calendar:<команда>` только номер записи, её
// `updated_at` и вид правки (триггер `calendar_change_signal`), а слушать
// тему пускает политика `realtime.messages` по праву на записи этого
// календаря. Телефон по сигналу перечитывает записи той же дверью.
//
// Канал на календарь, имя темы — ровно `calendar:<команда>`: политика сверяет
// её строкой, суффикс против дублей здесь невозможен. Поэтому подписка одна на
// жизнь моста, и мост снимает прежнюю перед новой.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../db/database.types";
import type { RealtimeChange } from "./realtime";

type DbSupabase = SupabaseClient<Database>;

export const CALENDAR_SIGNAL_EVENT = "appointment_changed";

export function calendarSignalTopic(teamId: string): string {
  return `calendar:${teamId}`;
}

/** Тело сигнала → изменение. Чужое и битое — `null`: мост перечитает
 *  календарь целиком, а не поверит мусору. */
export function calendarSignalChange(payload: unknown): RealtimeChange | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { id?: unknown; updated_at?: unknown; op?: unknown };
  if (typeof p.id !== "string" || p.id.length === 0) return null;
  return {
    event: typeof p.op === "string" ? p.op : "*",
    id: p.id,
    updatedAt: typeof p.updated_at === "string" ? p.updated_at : null,
  };
}

export interface CalendarSignalsOptions {
  supabase: DbSupabase;
  /** Календари, записи которых человек видит. Остальные сервер всё равно не
   *  отдаст — лишняя тема только потратит соединение. */
  teamIds: readonly string[];
  /** Пришёл сигнал (`null` — тело не разобрать, перечитать всё). */
  onChange: (change: RealtimeChange | null) => void;
  /** Канал упал и поднялся: сигналы за обрыв потеряны, перечитать всё. */
  onResync: () => void;
}

export function startCalendarSignals(options: CalendarSignalsOptions): () => void {
  const { supabase, onChange, onResync } = options;
  const teamIds = [...new Set(options.teamIds)].filter((id) => id.length > 0);
  if (teamIds.length === 0) return () => {};

  let stopped = false;
  const channels = teamIds.map((teamId) =>
    supabase
      .channel(calendarSignalTopic(teamId), { config: { private: true } })
      .on("broadcast", { event: CALENDAR_SIGNAL_EVENT }, (message: { payload?: unknown }) => {
        onChange(calendarSignalChange(message?.payload));
      }),
  );

  // Приватная тема проверяет вход токеном — его надо отдать сокету до
  // подписки, иначе первый заход уйдёт анонимным и получит отказ.
  void supabase.realtime.setAuth().then(() => {
    if (stopped) return;
    for (const channel of channels) {
      let dropped = false;
      channel.subscribe((status: string) => {
        if (status === "SUBSCRIBED") {
          if (dropped) onResync();
          dropped = false;
        } else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          dropped = true;
        }
      });
    }
  });

  return () => {
    stopped = true;
    for (const channel of channels) void supabase.removeChannel(channel);
  };
}
