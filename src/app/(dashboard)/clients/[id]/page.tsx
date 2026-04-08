import { notFound } from "next/navigation";
import Link from "next/link";
import {
  getClientById,
  getClientEquipment,
  getClientOrders,
  getClientPayments,
} from "@/lib/queries/clients";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClientInfoTab } from "@/components/clients/client-info-tab";
import { EquipmentTab } from "@/components/clients/equipment-tab";
import { OrdersTab } from "@/components/clients/orders-tab";
import { FinanceTab } from "@/components/clients/finance-tab";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

interface Props {
  params: { id: string };
}

export default async function ClientDetailPage({ params }: Props) {
  const client = await getClientById(params.id);
  if (!client) notFound();

  const [equipment, orders, payments] = await Promise.all([
    getClientEquipment(params.id),
    getClientOrders(params.id),
    getClientPayments(params.id),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
          <Link href="/clients">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {client.full_name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {client.phone}
            {client.city && ` · ${client.city}`}
          </p>
        </div>
      </div>

      <Tabs defaultValue="info">
        <TabsList>
          <TabsTrigger value="info">Информация</TabsTrigger>
          <TabsTrigger value="equipment">
            Оборудование ({equipment.length})
          </TabsTrigger>
          <TabsTrigger value="orders">Заказы ({orders.length})</TabsTrigger>
          <TabsTrigger value="finance">Финансы</TabsTrigger>
        </TabsList>
        <TabsContent value="info" className="mt-6">
          <ClientInfoTab client={client} />
        </TabsContent>
        <TabsContent value="equipment" className="mt-6">
          <EquipmentTab clientId={client.id} equipment={equipment} />
        </TabsContent>
        <TabsContent value="orders" className="mt-6">
          <OrdersTab orders={orders} />
        </TabsContent>
        <TabsContent value="finance" className="mt-6">
          <FinanceTab client={client} payments={payments} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
