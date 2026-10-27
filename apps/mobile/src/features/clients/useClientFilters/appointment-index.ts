import type { Client } from "@babun/shared/local/clients";
import type { Appointment } from "@babun/shared/local/appointments";
import { nameInComment } from "@babun/shared/local/selectors/client-stats";

// Per-client index of appointments: teams and dates, one pass.

/** Свободная нормализация имени — зеркалит seed-fallback buildStatsMap. */
function normName(s: string): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export interface ClientAppointmentIndex {
  /** clientId → множество team_id по записям клиента. */
  clientTeams: Map<string, Set<string>>;
  /** clientId → список дат записей (YYYY-MM-DD). */
  clientApptDates: Map<string, string[]>;
}

/** Один проход по записям — два индекса по клиенту. Включая fallback по
 *  имени в comment для seed-записей с client_id:null (как buildStatsMap). */
export function buildClientAppointmentIndex(
  clients: Client[],
  appointments: Appointment[],
): ClientAppointmentIndex {
  const byId = new Map<string, Appointment[]>();
  const orphanByName = new Map<string, Appointment[]>();
  for (const a of appointments) {
    // A cancelled visit is not part of the relationship history. Counting
    // it here made clients appear under a team/period even when their only
    // record in that facet had been cancelled.
    if (a.status === "cancelled") continue;
    if (a.client_id) {
      const arr = byId.get(a.client_id);
      if (arr) arr.push(a);
      else byId.set(a.client_id, [a]);
    } else if (a.kind !== "event") {
      // Событие без клиента («Перезвонить Анне») — не визит Анны: см.
      // `buildStatsMap`.
      const key = normName(a.comment);
      if (key) {
        const arr = orphanByName.get(key);
        if (arr) arr.push(a);
        else orphanByName.set(key, [a]);
      }
    }
  }

  const clientTeams = new Map<string, Set<string>>();
  const clientApptDates = new Map<string, string[]>();
  for (const c of clients) {
    const own = byId.get(c.id) ?? [];
    let combined: Appointment[];
    if (orphanByName.size > 0) {
      const cname = normName(c.full_name);
      const orphans: Appointment[] = [];
      for (const [name, arr] of orphanByName) {
        // Границы слова — как в buildStatsMap (короткое имя не ловит
        // подстроку: «Ан» не матчит «диван»).
        if (nameInComment(name, cname)) orphans.push(...arr);
      }
      combined = orphans.length === 0 ? own : own.concat(orphans);
    } else {
      combined = own;
    }
    const teamSet = new Set<string>();
    const dates: string[] = [];
    for (const a of combined) {
      if (a.team_id) teamSet.add(a.team_id);
      if (a.date) dates.push(a.date);
    }
    clientTeams.set(c.id, teamSet);
    clientApptDates.set(c.id, dates);
  }
  return { clientTeams, clientApptDates };
}
