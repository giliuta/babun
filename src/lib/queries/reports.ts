import { createClient } from "@/lib/supabase/server";

export async function getRevenueByCity() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("payments")
    .select("amount, order_id")
    .eq("status", "completed");

  if (!data || data.length === 0) return [];

  const orderIds = Array.from(
    new Set(data.map((p) => p.order_id).filter(Boolean) as string[]),
  );
  if (orderIds.length === 0) return [];

  const { data: orders } = await supabase
    .from("orders")
    .select("id, city")
    .in("id", orderIds);

  const orderCityMap = new Map((orders ?? []).map((o) => [o.id, o.city]));
  const cityRevenue: Record<string, number> = {};

  for (const p of data) {
    const city = p.order_id
      ? (orderCityMap.get(p.order_id) ?? "unknown")
      : "unknown";
    cityRevenue[city] = (cityRevenue[city] ?? 0) + Number(p.amount);
  }

  return Object.entries(cityRevenue).map(([city, revenue]) => ({
    city,
    revenue,
  }));
}

export async function getRevenueByCrew() {
  const supabase = await createClient();
  const { data: orders } = await supabase
    .from("orders")
    .select("total, crew_id")
    .eq("status", "completed");

  if (!orders || orders.length === 0) return [];

  const crewIds = Array.from(
    new Set(orders.map((o) => o.crew_id).filter(Boolean) as string[]),
  );
  const { data: crews } =
    crewIds.length > 0
      ? await supabase.from("crews").select("id, name, color").in("id", crewIds)
      : { data: [] as { id: string; name: string; color: string | null }[] };

  const crewMap = new Map((crews ?? []).map((c) => [c.id, c]));
  const crewRevenue: Record<
    string,
    { name: string; color: string; revenue: number; orders: number }
  > = {};

  for (const o of orders) {
    const crew = o.crew_id ? crewMap.get(o.crew_id) : null;
    const key = crew?.name ?? "Не назначена";
    if (!crewRevenue[key]) {
      crewRevenue[key] = {
        name: key,
        color: crew?.color ?? "#9ca3af",
        revenue: 0,
        orders: 0,
      };
    }
    crewRevenue[key].revenue += Number(o.total);
    crewRevenue[key].orders += 1;
  }

  return Object.values(crewRevenue);
}

export async function getOrderFunnel() {
  const supabase = await createClient();
  const { data: orders } = await supabase.from("orders").select("status");

  if (!orders) return [];

  const counts: Record<string, number> = {};
  for (const o of orders) {
    counts[o.status] = (counts[o.status] ?? 0) + 1;
  }

  const funnelOrder = [
    "new",
    "confirmed",
    "scheduled",
    "in_progress",
    "completed",
    "cancelled",
    "no_show",
  ];
  const labels: Record<string, string> = {
    new: "Новые",
    confirmed: "Подтверждённые",
    scheduled: "Запланированные",
    in_progress: "В работе",
    completed: "Завершённые",
    cancelled: "Отменённые",
    no_show: "Неявка",
  };

  return funnelOrder
    .filter((s) => counts[s])
    .map((status) => ({
      status: labels[status] ?? status,
      count: counts[status],
    }));
}

export async function getClientLtv() {
  const supabase = await createClient();
  const { data: clients } = await supabase
    .from("clients")
    .select("id, full_name, total_orders, total_revenue")
    .gt("total_orders", 0)
    .order("total_revenue", { ascending: false })
    .limit(20);

  return (clients ?? []).map((c) => ({
    name: c.full_name,
    orders: c.total_orders,
    revenue: Number(c.total_revenue),
    ltv: c.total_orders > 0 ? Number(c.total_revenue) / c.total_orders : 0,
  }));
}

export async function getExpenseBreakdown() {
  const supabase = await createClient();
  const { data: expenses } = await supabase
    .from("expenses")
    .select("category, amount");

  if (!expenses || expenses.length === 0) return [];

  const breakdown: Record<string, number> = {};
  for (const e of expenses) {
    breakdown[e.category] = (breakdown[e.category] ?? 0) + Number(e.amount);
  }

  const labels: Record<string, string> = {
    fuel: "Топливо",
    materials: "Материалы",
    equipment: "Оборудование",
    ads: "Реклама",
    rent: "Аренда",
    salary: "Зарплата",
    tax: "Налоги",
    insurance: "Страховка",
    other: "Прочее",
  };

  return Object.entries(breakdown).map(([cat, amount]) => ({
    category: labels[cat] ?? cat,
    amount,
  }));
}
