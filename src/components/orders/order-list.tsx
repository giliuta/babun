"use client";

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

const cityLabels: Record<string, string> = {
  limassol: "Лимассол",
  paphos: "Пафос",
  larnaca: "Ларнака",
  nicosia: "Никосия",
};

type OrderRow = {
  id: string;
  order_number: number;
  status: string;
  city: string;
  scheduled_date: string | null;
  total: number;
  payment_status: string;
  client: { id: string; full_name: string; phone: string } | null;
  crew: { id: string; name: string; color: string | null } | null;
};

export function OrderList({ orders }: { orders: OrderRow[] }) {
  if (orders.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Заказы не найдены
      </p>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>№</TableHead>
            <TableHead>Клиент</TableHead>
            <TableHead>Статус</TableHead>
            <TableHead>Город</TableHead>
            <TableHead>Дата</TableHead>
            <TableHead>Бригада</TableHead>
            <TableHead className="text-right">Сумма</TableHead>
            <TableHead>Оплата</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((o) => (
            <TableRow key={o.id}>
              <TableCell>
                <Link
                  href={`/orders/${o.id}`}
                  className="font-mono text-sm hover:underline"
                >
                  #{o.order_number}
                </Link>
              </TableCell>
              <TableCell>{o.client?.full_name ?? "—"}</TableCell>
              <TableCell>
                <Badge variant="outline" className={statusColors[o.status]}>
                  {statusLabels[o.status] ?? o.status}
                </Badge>
              </TableCell>
              <TableCell>{cityLabels[o.city] ?? o.city}</TableCell>
              <TableCell>{o.scheduled_date ?? "—"}</TableCell>
              <TableCell>{o.crew?.name ?? "—"}</TableCell>
              <TableCell className="text-right font-mono">
                €{Number(o.total).toFixed(2)}
              </TableCell>
              <TableCell>
                <Badge variant="outline">{o.payment_status}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
