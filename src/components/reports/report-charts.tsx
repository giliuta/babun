"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

const COLORS = [
  "#3b82f6",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
  "#f97316",
];

export function RevenueByCity({
  data,
}: {
  data: { city: string; revenue: number }[];
}) {
  const cityLabels: Record<string, string> = {
    limassol: "Лимассол",
    paphos: "Пафос",
    larnaca: "Ларнака",
    nicosia: "Никосия",
  };
  const labeled = data.map((d) => ({
    ...d,
    city: cityLabels[d.city] ?? d.city,
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={labeled}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="city" />
        <YAxis />
        <Tooltip formatter={(v) => `€${Number(v).toFixed(0)}`} />
        <Bar
          dataKey="revenue"
          name="Выручка"
          fill="#3b82f6"
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function RevenueByCrew({
  data,
}: {
  data: { name: string; color: string; revenue: number; orders: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" />
        <YAxis />
        <Tooltip formatter={(v) => `€${Number(v).toFixed(0)}`} />
        <Bar dataKey="revenue" name="Выручка" radius={[4, 4, 0, 0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function OrderFunnel({
  data,
}: {
  data: { status: string; count: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} layout="vertical">
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis type="number" />
        <YAxis dataKey="status" type="category" width={120} />
        <Tooltip />
        <Bar
          dataKey="count"
          name="Заказы"
          fill="#8b5cf6"
          radius={[0, 4, 4, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ExpenseBreakdown({
  data,
}: {
  data: { category: string; amount: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart>
        <Pie
          data={data}
          dataKey="amount"
          nameKey="category"
          cx="50%"
          cy="50%"
          outerRadius={100}
          label={(props) =>
            `${String(props.name ?? "")} ${((props.percent ?? 0) * 100).toFixed(0)}%`
          }
        >
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(v) => `€${Number(v).toFixed(0)}`} />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function ClientLtvTable({
  data,
}: {
  data: { name: string; orders: number; revenue: number; ltv: number }[];
}) {
  return (
    <div className="rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="p-3 text-left font-medium">Клиент</th>
            <th className="p-3 text-center font-medium">Заказы</th>
            <th className="p-3 text-right font-medium">Выручка</th>
            <th className="p-3 text-right font-medium">Ср. чек</th>
          </tr>
        </thead>
        <tbody>
          {data.map((c, i) => (
            <tr key={i} className="border-b">
              <td className="p-3">{c.name}</td>
              <td className="p-3 text-center">{c.orders}</td>
              <td className="p-3 text-right font-mono">
                €{c.revenue.toFixed(0)}
              </td>
              <td className="p-3 text-right font-mono">€{c.ltv.toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
