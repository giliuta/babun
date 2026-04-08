import { Suspense } from "react";
import { getOrders } from "@/lib/queries/orders";
import { getCrews } from "@/lib/queries/crews";
import { getServices } from "@/lib/queries/services";
import { getClients } from "@/lib/queries/clients";
import { KanbanBoard } from "@/components/orders/kanban-board";
import { OrderList } from "@/components/orders/order-list";
import { OrderFilters } from "@/components/orders/order-filters";
import { CreateOrderDialog } from "@/components/orders/create-order-dialog";

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
        <h1 className="text-2xl font-semibold tracking-tight">Заказы</h1>
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
