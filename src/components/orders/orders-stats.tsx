import { KpiCard } from "@/components/shared/kpi-card";
import { ClipboardList, Clock, CheckCircle2, DollarSign } from "lucide-react";

interface OrdersStatsProps {
  total: number;
  active: number;
  completedToday: number;
  todayRevenue: number;
}

export function OrdersStats({
  total,
  active,
  completedToday,
  todayRevenue,
}: OrdersStatsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard title="Всего заказов" value={total} icon={ClipboardList} />
      <KpiCard
        title="Активные"
        value={active}
        subtitle="new + confirmed + scheduled + in_progress"
        icon={Clock}
      />
      <KpiCard
        title="Завершено сегодня"
        value={completedToday}
        icon={CheckCircle2}
      />
      <KpiCard
        title="Выручка сегодня"
        value={`€${todayRevenue.toFixed(0)}`}
        icon={DollarSign}
      />
    </div>
  );
}
