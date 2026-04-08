import { createClient } from "@/lib/supabase/server";

export async function getCrews() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crews")
    .select("*")
    .eq("is_active", true)
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function getCrewById(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crews")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

export async function getCrewMembers(crewId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, phone, role")
    .eq("crew_id", crewId)
    .eq("is_active", true);
  if (error) throw error;
  return data ?? [];
}
