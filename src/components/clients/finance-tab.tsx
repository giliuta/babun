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

type Client = Database["public"]["Tables"]["clients"]["Row"];
type Payment = Pick<
  Database["public"]["Tables"]["payments"]["Row"],
  "id" | "amount" | "method" | "status" | "paid_at" | "notes"
>;

const methodLabels: Record<string, string> = {
  cash: "Наличные",
  card: "Карта",
  transfer: "Перевод",
  revolut: "Revolut",
};

export function FinanceTab({
  client,
  payments,
}: {
  client: Client;
  payments: Payment[];
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Всего заказов"
          value={client.total_orders.toString()}
        />
        <StatCard
          label="Общая выручка"
          value={`€${Number(client.total_revenue).toFixed(2)}`}
          mono
        />
        <StatCard
          label="Последний сервис"
          value={client.last_service_date ?? "—"}
        />
      </div>

      <div>
        <h3 className="mb-3 text-lg font-medium">История платежей</h3>
        {payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Нет платежей</p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Дата</TableHead>
                  <TableHead>Метод</TableHead>
                  <TableHead className="text-right">Сумма</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Примечание</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      {new Date(p.paid_at).toLocaleDateString("ru-RU")}
                    </TableCell>
                    <TableCell>{methodLabels[p.method] ?? p.method}</TableCell>
                    <TableCell className="text-right font-mono">
                      €{Number(p.amount).toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{p.status}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {p.notes ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${mono ? "font-mono" : ""}`}>
        {value}
      </p>
    </div>
  );
}
