// Service-due roll-up for the client card's «Обслуживание» spine.
//
// Wires the previously-dead `serviceDueState()` (equipment-sla.ts) to the
// UI: walks every object's A/C units, computes each unit's next-service
// state and buckets them into overdue → soon → on-schedule. The card
// renders overdue/soon as actionable rows («Записать ТО») and collapses
// on-schedule units to one quiet line per object. Units without a
// service interval produce no due-state and are simply skipped (the
// owner hasn't set up a schedule for them yet).
//
// Pure + typed. Keyed off `client.locations[].equipment[]`, NOT
// appointments — so legacy seed rows with client_id=null don't affect it.

import { serviceDueState, type ServiceDueState } from "../equipment-sla";
import { AC_TYPE_LABELS, type Client } from "../clients";

export interface UnitDue {
  locationId: string;
  locationLabel: string;
  unitId: string;
  /** Bare room, e.g. "Спальня" — for the hero's short «ТО · {room}». */
  room: string;
  /** "Спальня · Daikin FTXS35 · сплит" — room + brand/model + ac type. */
  unitLabel: string;
  due: ServiceDueState;
}

export interface OnScheduleObject {
  locationId: string;
  locationLabel: string;
  count: number;
}

export interface ServiceDueSummary {
  /** daysUntil < 0, most-overdue first. */
  overdue: UnitDue[];
  /** 0 ≤ daysUntil ≤ 14, soonest first. */
  soon: UnitDue[];
  /** Units on schedule, grouped by object (collapsed line in the UI). */
  onSchedule: OnScheduleObject[];
  /** Units that have a schedule at all (overdue + soon + on-schedule). The
   *  spine hides itself entirely when this is 0. */
  totalScheduled: number;
}

const EMPTY: ServiceDueSummary = {
  overdue: [],
  soon: [],
  onSchedule: [],
  totalScheduled: 0,
};

function unitLabel(room: string, brand?: string, model?: string, acType?: string): string {
  const gear = [brand, model].filter(Boolean).join(" ").trim();
  const type = acType ? AC_TYPE_LABELS[acType as keyof typeof AC_TYPE_LABELS] : undefined;
  return [room, gear || undefined, type].filter(Boolean).join(" · ");
}

export function buildServiceDue(client: Pick<Client, "locations">): ServiceDueSummary {
  const locations = client.locations;
  if (!locations || locations.length === 0) return EMPTY;

  const overdue: UnitDue[] = [];
  const soon: UnitDue[] = [];
  const onScheduleCounts = new Map<string, OnScheduleObject>();

  for (const loc of locations) {
    const units = loc.equipment;
    if (!units || units.length === 0) continue;
    for (const unit of units) {
      const due = serviceDueState(unit);
      if (!due) continue; // no interval set → no schedule
      if (due.overdue) {
        overdue.push({
          locationId: loc.id,
          locationLabel: loc.label,
          unitId: unit.id,
          room: unit.room,
          unitLabel: unitLabel(unit.room, unit.brand, unit.model, unit.ac_type),
          due,
        });
      } else if (due.soon) {
        soon.push({
          locationId: loc.id,
          locationLabel: loc.label,
          unitId: unit.id,
          room: unit.room,
          unitLabel: unitLabel(unit.room, unit.brand, unit.model, unit.ac_type),
          due,
        });
      } else {
        const prev = onScheduleCounts.get(loc.id);
        if (prev) prev.count += 1;
        else onScheduleCounts.set(loc.id, { locationId: loc.id, locationLabel: loc.label, count: 1 });
      }
    }
  }

  overdue.sort((a, b) => a.due.daysUntil - b.due.daysUntil); // most overdue first
  soon.sort((a, b) => a.due.daysUntil - b.due.daysUntil); // soonest first

  const onSchedule = [...onScheduleCounts.values()];
  const totalScheduled =
    overdue.length + soon.length + onSchedule.reduce((s, o) => s + o.count, 0);

  return { overdue, soon, onSchedule, totalScheduled };
}
