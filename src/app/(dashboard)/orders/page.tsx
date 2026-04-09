import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { getOrders } from "@/lib/queries/orders";
import { getCrews } from "@/lib/queries/crews";
import { getServices } from "@/lib/queries/services";
import { getClients } from "@/lib/queries/clients";
import { KanbanBoard } from "@/components/orders/kanban-board";
import { OrderList } from "@/components/orders/order-list";
import { OrderFilters } from "@/components/orders/order-filters";
import { CreateOrderDialog } from "@/components/orders/create-order-dialog";
import { OrdersStats } from "@/components/orders/orders-stats";

interface Props {
  searchParams: {
    view?: string;
    city?: string;
    crew_id?: string;
    date?: string;
  };
}

export default async function OrdersPage({ searchParams }: Props) {
  const view = searchParams.view ?? "kanban";

  const [orders, crews, services, clientsData] = await Promise.all([
    getOrders({
      city: searchParams.city,
      crew_id: searchParams.crew_id,
      date: searchParams.date,
    }),
    getCrews(),
    getServices(),
    getClients({ perPage: 200 }),
  ]);

  // Stats
  const today = new Date().toISOString().split("T")[0];
  const active = orders.filter((o) =>
    ["new", "confirmed", "scheduled", "in_progress"].includes(o.status),
  ).length;
  const completedToday = orders.filter(
    (o) => o.status === "completed" && o.completed_at?.startsWith(today),
  ).length;

  let todayRevenue = 0;
  try {
    const supabase = await createClient();
    const { data: todayPayments } = await supabase
      .from("payments")
      .select("amount")
      .gte("paid_at", today)
      .eq("status", "completed");
    todayRevenue = (todayPayments ?? []).reduce(
      (s, p) => s + Number(p.amount),
      0,
    );
  } catch {
    // ignore
  }

  const clientsForForm = clientsData.clients.map((c) => ({
    id: c.id,
    full_name: c.full_name,
    phone: c.phone,
    city: c.city,
    address: c.address,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Заказы</h1>
          <p className="text-sm text-muted-foreground">
            Управление заказами и статусами
          </p>
        </div>
        <CreateOrderDialog
          clients={clientsForForm}
          crews={crews.map((c) => ({ id: c.id, name: c.name, city: c.city }))}
          services={services.map((s) => ({
            id: s.id,
            name: s.name,
            price: Number(s.price),
            price_bulk: s.price_bulk ? Number(s.price_bulk) : null,
            bulk_threshold: s.bulk_threshold,
          }))}
        />
      </div>
      <OrdersStats
        total={orders.length}
        active={active}
        completedToday={completedToday}
        todayRevenue={todayRevenue}
      />
      <Suspense fallback={null}>
        <OrderFilters
          crews={crews.map((c) => ({ id: c.id, name: c.name }))}
          view={view}
        />
      </Suspense>
      {view === "kanban" ? (
        <KanbanBoard orders={orders} />
      ) : (
        <OrderList orders={orders} />
      )}
    </div>
  );
}
