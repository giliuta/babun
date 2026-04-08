import { createClient } from "@/lib/supabase/server";

export async function getReEngagementClients(monthsInactive: number = 3) {
  const supabase = await createClient();
  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - monthsInactive);
  const cutoff = cutoffDate.toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("clients")
    .select(
      "id, full_name, phone, city, last_service_date, total_orders, total_revenue, language",
    )
    .lt("last_service_date", cutoff)
    .gt("total_orders", 0)
    .order("last_service_date", { ascending: true });

  if (error) {
    console.error("clients", error.message);
    return [];
  }
  return data ?? [];
}

export async function getUpcomingReminders() {
  const supabase = await createClient();
  // Clients with next_service_date in the next 14 days
  const today = new Date().toISOString().split("T")[0];
  const twoWeeks = new Date(Date.now() + 14 * 86400000)
    .toISOString()
    .split("T")[0];

  const { data, error } = await supabase
    .from("clients")
    .select("id, full_name, phone, city, next_service_date, language")
    .gte("next_service_date", today)
    .lte("next_service_date", twoWeeks)
    .order("next_service_date");

  if (error) {
    console.error("clients", error.message);
    return [];
  }
  return data ?? [];
}

export async function getNotificationTemplates() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notification_templates")
    .select("*")
    .order("trigger_event");
  if (error) {
    console.error("notification_templates", error.message);
    return [];
  }
  return data ?? [];
}

export async function getNotificationLog(limit: number = 50) {
  const supabase = await createClient();
  const { data: logs, error } = await supabase
    .from("notification_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("notification_log", error.message);
    return [];
  }
  if (!logs || logs.length === 0) return [];

  const clientIds = Array.from(
    new Set(logs.map((l) => l.client_id).filter(Boolean) as string[]),
  );
  let clientMap = new Map<string, string>();
  if (clientIds.length > 0) {
    const { data: clients } = await supabase
      .from("clients")
      .select("id, full_name")
      .in("id", clientIds);
    clientMap = new Map((clients ?? []).map((c) => [c.id, c.full_name]));
  }

  return logs.map((l) => ({
    ...l,
    client_name: l.client_id ? (clientMap.get(l.client_id) ?? null) : null,
  }));
}
