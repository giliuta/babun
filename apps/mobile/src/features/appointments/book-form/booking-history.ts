import type { Appointment } from "@babun/shared/local/appointments";

// «Smart defaults from history» of the booking form: pure reads over the
// calendar list that is already in the cache.

interface TeamRef {
  id: string;
}

type HistoryRow = Pick<
  Appointment,
  "team_id" | "created_at" | "client_id" | "date" | "time_start"
>;

/** Team of the most recently CREATED appointment, among live teams. */
export function lastCreatedTeamId(
  allAppts: readonly HistoryRow[],
  teams: readonly TeamRef[],
): string | null {
  let best: string | null = null;
  let bestTs = "";
  for (const a of allAppts) {
    if (a.team_id && a.created_at > bestTs && teams.some((tm) => tm.id === a.team_id)) {
      bestTs = a.created_at;
      best = a.team_id;
    }
  }
  return best;
}

/** Up to five clients of the latest visits (by date, then start time). */
export function recentClientIdsOf(allAppts: readonly HistoryRow[]): string[] {
  const sorted = [...allAppts]
    .filter((a) => a.client_id)
    .sort((a, b) =>
      a.date !== b.date
        ? b.date.localeCompare(a.date)
        : b.time_start.localeCompare(a.time_start),
    );
  const out: string[] = [];
  for (const a of sorted) {
    const id = a.client_id as string;
    if (!out.includes(id)) {
      out.push(id);
      if (out.length >= 5) break;
    }
  }
  return out;
}
