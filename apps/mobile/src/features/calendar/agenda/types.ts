import type { Appointment } from "@babun/shared/local/appointments";

export interface AgendaSection {
  title: string; // YYYY-MM-DD
  data: Appointment[];
}
