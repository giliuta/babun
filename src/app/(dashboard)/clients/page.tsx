import { Suspense } from "react";
import { getClients } from "@/lib/queries/clients";
import { ClientTable } from "@/components/clients/client-table";
import { ClientFilters } from "@/components/clients/client-filters";
import { AddClientDialog } from "@/components/clients/add-client-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportCsv } from "@/components/shared/export-csv";
import { Users } from "lucide-react";

interface Props {
  searchParams: {
    search?: string;
    city?: string;
    source?: string;
    page?: string;
  };
}

export default async function ClientsPage({ searchParams }: Props) {
  const { clients, total, page, totalPages } = await getClients({
    search: searchParams.search,
    city: searchParams.city,
    source: searchParams.source,
    page: searchParams.page ? parseInt(searchParams.page) : 1,
  });

  const hasFilters = !!(
    searchParams.search ||
    searchParams.city ||
    searchParams.source
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Клиенты</h1>
          <p className="text-sm text-muted-foreground">
            Управление клиентской базой
          </p>
        </div>
        <div className="flex gap-2">
          <ExportCsv
            data={clients.map((c) => ({
              name: c.full_name,
              phone: c.phone,
              city: c.city ?? "",
              email: c.email ?? "",
              orders: c.total_orders,
              revenue: c.total_revenue,
              source: c.source ?? "",
            }))}
            filename="clients"
          />
          <AddClientDialog />
        </div>
      </div>
      <Suspense fallback={null}>
        <ClientFilters />
      </Suspense>
      {clients.length === 0 && !hasFilters ? (
        <EmptyState
          icon={Users}
          title="Пока нет клиентов"
          description="Добавьте первого клиента чтобы начать работу с заказами"
          action={<AddClientDialog />}
        />
      ) : (
        <ClientTable
          clients={clients}
          total={total}
          page={page}
          totalPages={totalPages}
        />
      )}
    </div>
  );
}
