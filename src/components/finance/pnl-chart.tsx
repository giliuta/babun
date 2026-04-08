"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface PnlChartProps {
  data: {
    month: string;
    income: number;
    expense: number;
    profit: number;
  }[];
}

export function PnlChart({ data }: PnlChartProps) {
  return (
    <ResponsiveContainer width="100%" height={400}>
      <BarChart
        data={data}
        margin={{ top: 10, right: 10, left: 10, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis dataKey="month" className="text-xs" />
        <YAxis className="text-xs" />
        <Tooltip
          formatter={(value) => `€${Number(value).toFixed(0)}`}
          contentStyle={{
            backgroundColor: "hsl(var(--background))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "8px",
          }}
        />
        <Legend />
        <Bar
          dataKey="income"
          name="Доход"
          fill="#22c55e"
          radius={[4, 4, 0, 0]}
        />
        <Bar
          dataKey="expense"
          name="Расход"
          fill="#ef4444"
          radius={[4, 4, 0, 0]}
        />
        <Bar
          dataKey="profit"
          name="Прибыль"
          fill="#3b82f6"
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
