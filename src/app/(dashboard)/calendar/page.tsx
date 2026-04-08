import { getOrders } from "@/lib/queries/orders";
import { getCrews } from "@/lib/queries/crews";
import { CalendarView } from "@/components/calendar/calendar-view";

export default async function CalendarPage() {
  const [orders, crews] = await Promise.all([getOrders(), getCrews()]);

  const calendarOrders = orders.map((o) => ({
    id: o.id,
    order_number: o.order_number,
    scheduled_date: o.scheduled_date,
    scheduled_time_start: o.scheduled_time_start,
    city: o.city,
    client_name: o.client?.full_name ?? "—",
    address: o.address,
    crew_name: o.crew?.name ?? null,
    crew_color: o.crew?.color ?? null,
  }));

  const uniqueCities = Array.from(new Set(orders.map((o) => o.city)));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Календарь</h1>
      <CalendarView
        orders={calendarOrders}
        crews={crews.map((c) => ({ id: c.id, name: c.name }))}
        cities={uniqueCities}
      />
    </div>
  );
}
