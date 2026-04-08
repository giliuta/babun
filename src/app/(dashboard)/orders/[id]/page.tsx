import { notFound } from "next/navigation";
import Link from "next/link";
import {
  getOrderById,
  getOrderItems,
  getOrderComments,
  getOrderPhotos,
  getOrderPayments,
} from "@/lib/queries/orders";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, User, MapPin, Calendar, Phone } from "lucide-react";
import { OrderActionsBar } from "@/components/orders/order-actions-bar";
import { PaymentDialog } from "@/components/orders/payment-dialog";
import { ActivityLog } from "@/components/orders/activity-log";

const statusLabels: Record<string, string> = {
  new: "Новый",
  confirmed: "Подтверждён",
  scheduled: "Запланирован",
  in_progress: "В работе",
  completed: "Завершён",
  cancelled: "Отменён",
  no_show: "Неявка",
};

const statusColors: Record<string, string> = {
  new: "bg-gray-100 text-gray-800",
  confirmed: "bg-blue-100 text-blue-800",
  scheduled: "bg-amber-100 text-amber-800",
  in_progress: "bg-purple-100 text-purple-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-800",
  no_show: "bg-orange-100 text-orange-800",
};

interface Props {
  params: { id: string };
}

export default async function OrderDetailPage({ params }: Props) {
  let order;
  try {
    order = await getOrderById(params.id);
  } catch {
    notFound();
  }

  const [items, comments, photos, payments] = await Promise.all([
    getOrderItems(params.id),
    getOrderComments(params.id),
    getOrderPhotos(params.id),
    getOrderPayments(params.id),
  ]);

  const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0);
  const remaining = Number(order.total) - totalPaid;
  const client = order.client;
  const crew = order.crew as {
    id: string;
    name: string;
    color: string | null;
    city: string;
  } | null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
            <Link href="/orders">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">
                Заказ #{order.order_number}
              </h1>
              <Badge className={statusColors[order.status]}>
                {statusLabels[order.status] ?? order.status}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Создан {new Date(order.created_at).toLocaleDateString("ru-RU")}
            </p>
          </div>
        </div>
        <OrderActionsBar orderId={order.id} status={order.status} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main content */}
        <div className="space-y-6 lg:col-span-2">
          {/* Order info */}
          <div className="grid gap-4 sm:grid-cols-2">
            <InfoCard icon={MapPin} label="Город / Адрес">
              {order.city}
              {order.address ? `, ${order.address}` : ""}
              {order.address_details && (
                <span className="block text-muted-foreground">
                  {order.address_details}
                </span>
              )}
            </InfoCard>
            <InfoCard icon={Calendar} label="Дата">
              {order.scheduled_date ?? "Не назначена"}
              {order.scheduled_time_start && ` ${order.scheduled_time_start}`}
            </InfoCard>
          </div>

          {/* Items */}
          <div>
            <h3 className="mb-3 text-lg font-medium">Позиции</h3>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Услуга</TableHead>
                    <TableHead className="text-center">Кол-во</TableHead>
                    <TableHead className="text-right">Цена</TableHead>
                    <TableHead className="text-right">Итого</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        {item.service_name ?? item.description ?? "—"}
                      </TableCell>
                      <TableCell className="text-center">
                        {item.quantity}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        €{Number(item.unit_price).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        €{Number(item.total).toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell colSpan={3} className="text-right font-medium">
                      Итого
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold">
                      €{Number(order.total).toFixed(2)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Payment */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-medium">Оплата</h3>
              {remaining > 0 && (
                <PaymentDialog
                  orderId={order.id}
                  clientId={order.client_id}
                  remaining={remaining}
                />
              )}
            </div>
            <div className="flex gap-4 text-sm">
              <span>
                Оплачено:{" "}
                <strong className="font-mono">€{totalPaid.toFixed(2)}</strong>
              </span>
              <span>
                Остаток:{" "}
                <strong className="font-mono">€{remaining.toFixed(2)}</strong>
              </span>
              <Badge variant="outline">{order.payment_status}</Badge>
            </div>
            {payments.length > 0 && (
              <div className="mt-3 rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Дата</TableHead>
                      <TableHead>Метод</TableHead>
                      <TableHead className="text-right">Сумма</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>
                          {new Date(p.paid_at).toLocaleDateString("ru-RU")}
                        </TableCell>
                        <TableCell>{p.method}</TableCell>
                        <TableCell className="text-right font-mono">
                          €{Number(p.amount).toFixed(2)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          {/* Photos */}
          {photos.length > 0 && (
            <div>
              <h3 className="mb-3 text-lg font-medium">Фото</h3>
              <div className="grid grid-cols-3 gap-3">
                {photos.map((p) => (
                  <div
                    key={p.id}
                    className="relative overflow-hidden rounded-md border"
                  >
                    <img
                      src={p.url}
                      alt={p.type}
                      className="aspect-square object-cover"
                    />
                    <Badge
                      className="absolute bottom-1 left-1 text-xs"
                      variant="secondary"
                    >
                      {p.type === "before"
                        ? "До"
                        : p.type === "after"
                          ? "После"
                          : "Другое"}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Separator />

          {/* Activity */}
          <ActivityLog orderId={order.id} comments={comments} />
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Client card */}
          <div className="rounded-lg border p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-medium">
              <User className="h-4 w-4" />
              Клиент
            </h3>
            {client ? (
              <div className="space-y-2 text-sm">
                <Link
                  href={`/clients/${client.id}`}
                  className="font-medium hover:underline"
                >
                  {client.full_name}
                </Link>
                <p className="flex items-center gap-1 text-muted-foreground">
                  <Phone className="h-3 w-3" />
                  {client.phone}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">—</p>
            )}
          </div>

          {/* Crew card */}
          <div className="rounded-lg border p-4">
            <h3 className="mb-3 text-sm font-medium">Бригада</h3>
            {crew ? (
              <div className="space-y-1 text-sm">
                <p
                  className="font-medium"
                  style={{ color: crew.color ?? undefined }}
                >
                  {crew.name}
                </p>
                <p className="text-muted-foreground">{crew.city}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Не назначена</p>
            )}
          </div>

          {/* Notes */}
          {(order.client_notes || order.internal_notes) && (
            <div className="rounded-lg border p-4">
              <h3 className="mb-3 text-sm font-medium">Заметки</h3>
              {order.client_notes && (
                <div className="mb-2">
                  <p className="text-xs text-muted-foreground">Клиент:</p>
                  <p className="text-sm">{order.client_notes}</p>
                </div>
              )}
              {order.internal_notes && (
                <div>
                  <p className="text-xs text-muted-foreground">Внутренние:</p>
                  <p className="text-sm">{order.internal_notes}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoCard({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border p-4">
      <p className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </p>
      <p className="text-sm">{children}</p>
    </div>
  );
}
