import { createClient } from "@/lib/supabase/server";
import { getCrews, getCrewMembers } from "@/lib/queries/crews";
import { CrewCard } from "@/components/crews/crew-card";
import { AddCrewDialog } from "@/components/crews/add-crew-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { Wrench } from "lucide-react";

export default async function CrewsPage() {
  const supabase = await createClient();
  const crews = await getCrews();

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .split("T")[0];

  const crewData = await Promise.all(
    crews.map(async (crew) => {
      const [members, { data: monthOrders }] = await Promise.all([
        getCrewMembers(crew.id),
        supabase
          .from("orders")
          .select("total")
          .eq("crew_id", crew.id)
          .eq("status", "completed")
          .gte("completed_at", monthStart),
      ]);
      const orders = monthOrders ?? [];
      return {
        crew,
        members: members.map((m) => ({
          id: m.id,
          full_name: m.full_name,
          role: m.role,
        })),
        stats: {
          orders: orders.length,
          revenue: orders.reduce((s, o) => s + Number(o.total), 0),
        },
      };
    }),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Бригады</h1>
          <p className="text-sm text-muted-foreground">
            Управление бригадами и работниками
          </p>
        </div>
        <AddCrewDialog />
      </div>
      {crewData.length === 0 ? (
        <EmptyState
          icon={Wrench}
          title="Пока нет бригад"
          description="Создайте первую бригаду для назначения заказов"
          action={<AddCrewDialog />}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {crewData.map(({ crew, members, stats }) => (
            <CrewCard
              key={crew.id}
              crew={crew}
              members={members}
              stats={stats}
            />
          ))}
        </div>
      )}
    </div>
  );
}
