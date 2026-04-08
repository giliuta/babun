import { createClient } from "@/lib/supabase/server";

export interface OrderFilters {
  city?: string;
  status?: string;
  crew_id?: string;
  date?: string;
}

export type OrderWithRelations = {
  id: string;
  order_number: number;
  status: string;
  city: string;
  address: string | null;
  address_details: string | null;
  scheduled_date: string | null;
  scheduled_time_start: string | null;
  total: number;
  payment_status: string;
  payment_method: string | null;
  client_id: string;
  crew_id: string | null;
  client_notes: string | null;
  internal_notes: string | null;
  completed_at: string | null;
  created_at: string;
  client: { id: string; full_name: string; phone: string } | null;
  crew: { id: string; name: string; color: string | null; city: string } | null;
};

export async function getOrders(
  filters: OrderFilters = {},
): Promise<OrderWithRelations[]> {
  const supabase = await createClient();
  let query = supabase
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false });

  if (filters.city) query = query.eq("city", filters.city);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.crew_id) query = query.eq("crew_id", filters.crew_id);
  if (filters.date) query = query.eq("scheduled_date", filters.date);

  const { data: orders, error } = await query;
  if (error) {
    console.error("orders", error.message);
    return [];
  }
  if (!orders || orders.length === 0) return [];

  // Enrich with client and crew data
  const clientIds = Array.from(new Set(orders.map((o) => o.client_id)));
  const crewIds = Array.from(
    new Set(orders.map((o) => o.crew_id).filter(Boolean) as string[]),
  );

  let clientMap = new Map<
    string,
    { id: string; full_name: string; phone: string }
  >();
  let crewMap = new Map<
    string,
    { id: string; name: string; color: string | null; city: string }
  >();

  try {
    const [{ data: clients }, { data: crews }] = await Promise.all([
      supabase
        .from("clients")
        .select("id, full_name, phone")
        .in("id", clientIds),
      crewIds.length > 0
        ? supabase
            .from("crews")
            .select("id, name, color, city")
            .in("id", crewIds)
        : Promise.resolve({
            data: [] as {
              id: string;
              name: string;
              color: string | null;
              city: string;
            }[],
          }),
    ]);

    clientMap = new Map((clients ?? []).map((c) => [c.id, c]));
    crewMap = new Map((crews ?? []).map((c) => [c.id, c]));
  } catch (e) {
    console.error("orders enrichment", e);
  }

  return orders.map((o) => ({
    ...o,
    total: Number(o.total),
    client: clientMap.get(o.client_id) ?? null,
    crew: o.crew_id ? (crewMap.get(o.crew_id) ?? null) : null,
  }));
}

export async function getOrderById(id: string) {
  const supabase = await createClient();
  const { data: order, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", id)
    .single();
  if (error) {
    console.error("orders", error.message);
    return null;
  }

  let client = null;
  let crew = null;

  const { data: clientData } = await supabase
    .from("clients")
    .select("id, full_name, phone")
    .eq("id", order.client_id)
    .single();
  client = clientData;

  if (order.crew_id) {
    const { data: crewData } = await supabase
      .from("crews")
      .select("id, name, color, city")
      .eq("id", order.crew_id)
      .single();
    crew = crewData;
  }

  return { ...order, client, crew };
}

export type OrderItem = {
  id: string;
  description: string | null;
  quantity: number;
  unit_price: number;
  total: number;
  service_name: string | null;
};

export async function getOrderItems(orderId: string): Promise<OrderItem[]> {
  const supabase = await createClient();
  const { data: items, error } = await supabase
    .from("order_items")
    .select("*")
    .eq("order_id", orderId);
  if (error) {
    console.error("order_items", error.message);
    return [];
  }
  if (!items || items.length === 0) return [];

  const serviceIds = items.map((i) => i.service_id).filter(Boolean) as string[];
  let serviceMap = new Map<string, string>();

  if (serviceIds.length > 0) {
    const { data: services } = await supabase
      .from("services")
      .select("id, name")
      .in("id", serviceIds);
    serviceMap = new Map((services ?? []).map((s) => [s.id, s.name]));
  }

  return items.map((i) => ({
    id: i.id,
    description: i.description,
    quantity: i.quantity,
    unit_price: Number(i.unit_price),
    total: Number(i.total),
    service_name: i.service_id ? (serviceMap.get(i.service_id) ?? null) : null,
  }));
}

export type OrderComment = {
  id: string;
  type: string;
  content: string;
  created_at: string;
  author: { full_name: string } | null;
};

export async function getOrderComments(
  orderId: string,
): Promise<OrderComment[]> {
  const supabase = await createClient();
  const { data: comments, error } = await supabase
    .from("order_comments")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("order_comments", error.message);
    return [];
  }
  if (!comments || comments.length === 0) return [];

  const authorIds = Array.from(
    new Set(comments.map((c) => c.author_id).filter(Boolean) as string[]),
  );
  let authorMap = new Map<string, string>();

  if (authorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", authorIds);
    authorMap = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  }

  return comments.map((c) => ({
    id: c.id,
    type: c.type,
    content: c.content,
    created_at: c.created_at,
    author: c.author_id
      ? { full_name: authorMap.get(c.author_id) ?? "Unknown" }
      : null,
  }));
}

export async function getOrderPhotos(orderId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("order_photos")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("order_photos", error.message);
    return [];
  }
  return data ?? [];
}

export async function getOrderPayments(orderId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("order_id", orderId)
    .order("paid_at", { ascending: false });
  if (error) {
    console.error("payments", error.message);
    return [];
  }
  return data ?? [];
}
