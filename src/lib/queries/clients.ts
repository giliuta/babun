import { createClient } from "@/lib/supabase/server";

export interface ClientFilters {
  search?: string;
  city?: string;
  source?: string;
  page?: number;
  perPage?: number;
}

export async function getClients(filters: ClientFilters = {}) {
  const supabase = await createClient();
  const { search, city, source, page = 1, perPage = 20 } = filters;

  let query = supabase
    .from("clients")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false });

  if (search) {
    query = query.or(`full_name.ilike.%${search}%,phone.ilike.%${search}%`);
  }
  if (city) {
    query = query.eq("city", city);
  }
  if (source) {
    query = query.eq("source", source);
  }

  const from = (page - 1) * perPage;
  const to = from + perPage - 1;
  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) throw error;

  return {
    clients: data ?? [],
    total: count ?? 0,
    page,
    perPage,
    totalPages: Math.ceil((count ?? 0) / perPage),
  };
}

export async function getClientById(id: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
}

export async function getClientEquipment(clientId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("client_equipment")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function getClientOrders(clientId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, order_number, status, city, scheduled_date, total, payment_status, created_at",
    )
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function getClientPayments(clientId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("payments")
    .select("id, amount, method, status, paid_at, notes")
    .eq("client_id", clientId)
    .order("paid_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}
