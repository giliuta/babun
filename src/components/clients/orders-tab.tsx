import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Database } from "@/types/database";

type Order = Pick<
  Database["public"]["Tables"]["orders"]["Row"],
  | "id"
  | "order_number"
  | "status"
  | "city"
  | "scheduled_date"
  | "total"
  | "payment_status"
  | "created_at"
>;

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

const paymentLabels: Record<string, string> = {
  unpaid: "Не оплачен",
  partial: "Частично",
  paid: "Оплачен",
};

export function OrdersTab({ orders }: { orders: Order[] }) {
  if (orders.length === 0) {
    return <p className="text-sm text-muted-foreground">Нет заказов</p>;
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>№</TableHead>
            <TableHead>Статус</TableHead>
            <TableHead>Дата</TableHead>
            <TableHead className="text-right">Сумма</TableHead>
            <TableHead>Оплата</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((order) => (
            <TableRow key={order.id}>
              <TableCell>
                <Link
                  href={`/orders/${order.id}`}
                  className="font-mono text-sm hover:underline"
                >
                  #{order.order_number}
                </Link>
              </TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className={statusColors[order.status] ?? ""}
                >
                  {statusLabels[order.status] ?? order.status}
                </Badge>
              </TableCell>
              <TableCell>{order.scheduled_date ?? "—"}</TableCell>
              <TableCell className="text-right font-mono">
                €{Number(order.total).toFixed(2)}
              </TableCell>
              <TableCell>
                <Badge variant="outline">
                  {paymentLabels[order.payment_status] ?? order.payment_status}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
