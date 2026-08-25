import type { Appointment } from "@babun/shared/local/appointments";
import { supabase } from "@/lib/supabase";
import {
  masterAppointmentJsonToAppointment as mapMasterAppointmentJson,
} from "./master-appointment-mapper";

export { masterAppointmentJsonToAppointment } from "./master-appointment-mapper";

const PAGE_SIZE = 1000;

/** Paged because PostgREST caps each RPC response at 1000 rows. */
export async function listMasterAppointmentsSafePaged(): Promise<Appointment[]> {
  const all: Appointment[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase.rpc("list_master_appointments_safe", {
      p_limit: PAGE_SIZE,
      p_offset: offset,
    });
    if (error) {
      throw new Error(`listMasterAppointmentsSafe: ${error.message}`);
    }
    const page = data ?? [];
    all.push(...page.map(mapMasterAppointmentJson));
    if (page.length < PAGE_SIZE) return all;
  }
}
