import { createClient } from "@/lib/supabase/server";

export async function getDashboardStats() {
  const supabase = await createClient();

  const today = new Date().toISOString().split("T")[0];
  const monthStart = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1,
  )
    .toISOString()
    .split("T")[0];

  const [
    { count: totalClients },
    { count: totalOrders },
    { count: todayOrders },
    { count: activeOrders },
    { data: monthPayments },
    { data: monthExpenses },
  ] = await Promise.all([
    supabase.from("clients").select("*", { count: "exact", head: true }),
    supabase.from("orders").select("*", { count: "exact", head: true }),
    supabase
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("scheduled_date", today),
    supabase
      .from("orders")
      .select("*", { count: "exact", head: true })
      .in("status", ["new", "confirmed", "scheduled", "in_progress"]),
    supabase
      .from("payments")
      .select("amount")
      .gte("paid_at", monthStart)
      .eq("status", "completed"),
    supabase.from("expenses").select("amount").gte("date", monthStart),
  ]);

  const monthRevenue = (monthPayments ?? []).reduce(
    (s, p) => s + Number(p.amount),
    0,
  );
  const monthExpense = (monthExpenses ?? []).reduce(
    (s, e) => s + Number(e.amount),
    0,
  );

  return {
    totalClients: totalClients ?? 0,
    totalOrders: totalOrders ?? 0,
    todayOrders: todayOrders ?? 0,
    activeOrders: activeOrders ?? 0,
    monthRevenue,
    monthExpense,
    monthProfit: monthRevenue - monthExpense,
  };
}
