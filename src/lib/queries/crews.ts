import { createClient } from "@/lib/supabase/server";

export async function getCrews() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crews")
    .select("*")
    .eq("is_active", true)
    .order("name");
  if (error) {
    console.error("crews", error.message);
    return [];
  }
  return data ?? [];
}

export async function getCrewById(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crews")
    .select("*")
    .eq("id", id)
    .single();
  if (error) {
    console.error("crews", error.message);
    return null;
  }
  return data;
}

export async function getCrewMembers(crewId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, phone, role")
    .eq("crew_id", crewId)
    .eq("is_active", true);
  if (error) {
    console.error("profiles", error.message);
    return [];
  }
  return data ?? [];
}
