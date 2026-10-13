import type { Appointment } from "@babun/shared/local/appointments";
import { expandRepeat } from "@babun/shared/common/utils/expand-repeat";
import { formatYMD } from "@/features/appointments/helpers";
import type { AgendaSection } from "@/features/calendar/AgendaView";
import { addDays } from "./dates";

/** Records bucketed by `date`; order inside a day follows the input. */
export function groupByDate<T extends { date: string }>(
  list: readonly T[],
): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const a of list) {
    const arr = m.get(a.date) ?? [];
    arr.push(a);
    m.set(a.date, arr);
  }
  return m;
}

/** Agenda sections for the whole month of `monthAnchor`: records sorted by
 *  date, then start time, one section per day. */
export function agendaMonthSections(
  visible: readonly Appointment[],
  monthAnchor: Date,
): AgendaSection[] {
  const startKey = formatYMD(monthAnchor);
  const endKey = formatYMD(
    addDays(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 1), -1),
  );
  const filtered = visible
    .filter((a) => a.date >= startKey && a.date <= endKey)
    .sort((a, b) =>
      a.date !== b.date
        ? a.date.localeCompare(b.date)
        : a.time_start.localeCompare(b.time_start),
    );
  return [...groupByDate(filtered).entries()].map(([d, data]) => ({ title: d, data }));
}

/** Only what moves a push notification: id, date, start, status, team and
 *  the event push flag. */
export function reminderSignature(appts: readonly Appointment[]): string {
  return appts
    .map((a) => `${a.id}|${a.date}|${a.time_start}|${a.status}|${a.team_id ?? ""}|${a.event_push_enabled ? 1 : 0}`)
    .join(";");
}

export type OccurrenceCache = Map<string, { seed: Appointment; occ: Appointment }>;

/** Expands repeating seeds inside [fromKey, toKey]. An occurrence keeps the
 *  object from `cache` while its seed is the same object, so memoised grid
 *  columns see stable references. Returns the list and the next cache. */
export function expandWithOccurrenceCache(
  appts: readonly Appointment[],
  fromKey: string,
  toKey: string,
  cache: OccurrenceCache,
): { list: Appointment[]; cache: OccurrenceCache } {
  const next: OccurrenceCache = new Map();
  const out: Appointment[] = [];
  for (const a of appts) {
    const rule = a.event_repeat;
    if (!rule || rule.kind === "none") {
      out.push(a);
      continue;
    }
    for (const occ of expandRepeat(a, fromKey, toKey, { includeCancelled: true })) {
      if (occ === a) {
        out.push(occ);
        continue;
      }
      const hit = cache.get(occ.id);
      const kept = hit && hit.seed === a ? hit.occ : occ;
      next.set(occ.id, { seed: a, occ: kept });
      out.push(kept);
    }
  }
  return { list: out, cache: next };
}
