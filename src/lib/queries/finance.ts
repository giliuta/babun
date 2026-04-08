import { createClient } from "@/lib/supabase/server";

export interface FinanceFilters {
  dateFrom?: string;
  dateTo?: string;
  method?: string;
  category?: string;
}

export async function getPayments(filters: FinanceFilters = {}) {
  const supabase = await createClient();
  let query = supabase
    .from("payments")
    .select("*")
    .order("paid_at", { ascending: false });

  if (filters.dateFrom) query = query.gte("paid_at", filters.dateFrom);
  if (filters.dateTo)
    query = query.lte("paid_at", filters.dateTo + "T23:59:59");
  if (filters.method) query = query.eq("method", filters.method);

  const { data, error } = await query;
  if (error) {
    console.error("payments", error.message);
    return [];
  }
  return data ?? [];
}

export async function getExpenses(filters: FinanceFilters = {}) {
  const supabase = await createClient();
  let query = supabase
    .from("expenses")
    .select("*")
    .order("date", { ascending: false });

  if (filters.dateFrom) query = query.gte("date", filters.dateFrom);
  if (filters.dateTo) query = query.lte("date", filters.dateTo);
  if (filters.category) query = query.eq("category", filters.category);

  const { data, error } = await query;
  if (error) {
    console.error("expenses", error.message);
    return [];
  }
  return data ?? [];
}

export async function getSalaryRecords() {
  const supabase = await createClient();
  const { data: records, error } = await supabase
    .from("salary_records")
    .select("*")
    .order("period_start", { ascending: false });
  if (error) {
    console.error("salary_records", error.message);
    return [];
  }
  if (!records || records.length === 0) return [];

  const profileIds = Array.from(new Set(records.map((r) => r.profile_id)));
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", profileIds);

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  return records.map((r) => ({
    ...r,
    profile_name: profileMap.get(r.profile_id) ?? "Unknown",
  }));
}

export async function getPnlData(year: number) {
  const supabase = await createClient();
  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;

  const [{ data: payments }, { data: expenses }] = await Promise.all([
    supabase
      .from("payments")
      .select("amount, paid_at")
      .gte("paid_at", startDate)
      .lte("paid_at", endDate + "T23:59:59")
      .eq("status", "completed"),
    supabase
      .from("expenses")
      .select("amount, date, category")
      .gte("date", startDate)
      .lte("date", endDate),
  ]);

  const months = Array.from({ length: 12 }, (_, i) => {
    const month = String(i + 1).padStart(2, "0");
    const monthPayments = (payments ?? []).filter((p) =>
      p.paid_at.startsWith(`${year}-${month}`),
    );
    const monthExpenses = (expenses ?? []).filter((e) =>
      e.date.startsWith(`${year}-${month}`),
    );
    const income = monthPayments.reduce((s, p) => s + Number(p.amount), 0);
    const expense = monthExpenses.reduce((s, e) => s + Number(e.amount), 0);
    return {
      month: new Date(year, i).toLocaleDateString("ru-RU", { month: "short" }),
      income,
      expense,
      profit: income - expense,
    };
  });

  return months;
}
