import { Suspense } from "react";
import { getClients } from "@/lib/queries/clients";
import { ClientTable } from "@/components/clients/client-table";
import { ClientFilters } from "@/components/clients/client-filters";
import { AddClientDialog } from "@/components/clients/add-client-dialog";

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Клиенты</h1>
        <AddClientDialog />
      </div>
      <Suspense fallback={null}>
        <ClientFilters />
      </Suspense>
      <ClientTable
        clients={clients}
        total={total}
        page={page}
        totalPages={totalPages}
      />
    </div>
  );
}
