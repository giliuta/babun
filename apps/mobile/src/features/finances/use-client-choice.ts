import { useMemo } from "react";
import { buildStatsMap } from "@babun/shared/local/selectors/client-stats";
import { useAppointments } from "@/features/calendar/queries";
import { useClients } from "@/features/clients/queries";

// ВЫБОР КЛИЕНТА ЗА ПРЕДЕЛАМИ ЗАПИСИ.
//
// Блок клиента в записи опирается на три вещи: список, вводную о каждом
// (долг, визиты, последний приезд) и «недавних» первыми. Долг спрашивает
// ровно того же клиента — значит и вводная должна быть та же, иначе один и
// тот же человек выглядит по-разному на соседних экранах.
//
// Клиента, заведённого «на ходу», забирает из ящика САМА форма (см.
// `pending-client.ts` и `DebtSheet`): у неё же лежит признак, что за клиентом
// уходила именно она, — чужую доставку брать нельзя.

/** Сколько недавних клиентов показывать первыми — столько же, сколько в записи. */
const RECENT_LIMIT = 5;

export function useClientChoice() {
  const clientsQuery = useClients();
  const appointmentsQuery = useAppointments();
  const clients = useMemo(() => clientsQuery.data ?? [], [clientsQuery.data]);
  const appointments = useMemo(
    () => appointmentsQuery.data ?? [],
    [appointmentsQuery.data],
  );

  // Карта на весь список строится ОДИН раз: `buildStats` на строку превратил
  // бы выбор клиента в квадрат по числу записей (тот же довод, что в записи).
  const statsById = useMemo(
    () => buildStatsMap(clients, appointments),
    [clients, appointments],
  );

  const recentIds = useMemo(() => {
    const sorted = [...appointments]
      .filter((a) => a.client_id)
      .sort((a, b) =>
        a.date !== b.date
          ? b.date.localeCompare(a.date)
          : (b.time_start ?? "").localeCompare(a.time_start ?? ""),
      );
    const out: string[] = [];
    for (const a of sorted) {
      const id = a.client_id as string;
      if (out.includes(id)) continue;
      out.push(id);
      if (out.length >= RECENT_LIMIT) break;
    }
    return out;
  }, [appointments]);

  return { clients, statsById, recentIds };
}
