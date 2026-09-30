import type { Appointment } from "@babun/shared/local/appointments";
import { supabase } from "@/lib/supabase";
import {
  masterAppointmentJsonToAppointment as mapMasterAppointmentJson,
} from "./master-appointment-mapper";

const PAGE_SIZE = 1000;

/** Paged because PostgREST caps each RPC response at 1000 rows.
 *  Клиент — параметром: прогрев чужой компании зовёт ту же функцию клиентом,
 *  привязанным к ней (`bind-tenant.ts`). */
export async function listMasterAppointmentsSafePaged(
  client: typeof supabase = supabase,
): Promise<Appointment[]> {
  const all: Appointment[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client.rpc("list_master_appointments_safe", {
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
