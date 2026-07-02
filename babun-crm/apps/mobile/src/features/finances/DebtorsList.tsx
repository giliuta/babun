import { useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import { formatEUR } from "@babun/shared/common/utils/money";
import {
  getDebtAmount,
  type Appointment,
} from "@babun/shared/local/appointments";
import type { Client } from "@babun/shared/local/clients";
import { useThemeColors } from "@/theme/colors";

// «Долги» panel — port of the web DebtorsList
// (apps/web/src/components/finance/DebtorsList.tsx): completed-but-unpaid
// appointments for the active team in the period, client + outstanding sum.
// The outstanding sum comes from the shared getDebtAmount (prepaid +
// payments[]): the web-only payment_status/paid_amount fields are never
// mapped by the mobile repository, so relying on them would list every
// completed visit — paid ones included — at its full price.
export function DebtorsList({
  appointments,
  clients,
  teamId,
  fromDate,
  toDate,
}: {
  appointments: Appointment[];
  clients: Client[];
  teamId: string | null;
  fromDate: string;
  toDate: string;
}) {
  const t = useThemeColors();
  const rows = useMemo(
    () =>
      appointments
        .filter(
          (a) =>
            a.status === "completed" &&
            a.date >= fromDate &&
            a.date <= toDate &&
            (!teamId || a.team_id === teamId),
        )
        .map((a) => ({
          id: a.id,
          name: clientName(a, clients),
          owed: getDebtAmount(a),
          date: a.date,
        }))
        .filter((r) => r.owed > 0)
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [appointments, clients, teamId, fromDate, toDate],
  );

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 96 }}>
      <View
        className="mx-3 mt-2 overflow-hidden rounded-2xl"
        style={{ backgroundColor: t.surface }}
      >
        {rows.length === 0 ? (
          <Text
            className="px-4 py-6 text-center text-xs"
            style={{ color: t.faint }}
          >
            Нет должников за период
          </Text>
        ) : (
          rows.map((r, i) => (
            <View
              key={r.id}
              className="flex-row items-center gap-3 px-4 py-2.5"
              style={
                i > 0
                  ? { borderTopWidth: 1, borderTopColor: t.separator }
                  : undefined
              }
            >
              <Text
                className="flex-1 text-[15px] font-medium"
                style={{ color: t.ink }}
                numberOfLines={1}
              >
                {r.name}
              </Text>
              <Text
                className="text-[15px] font-bold tabular-nums"
                style={{ color: t.warning }}
              >
                {formatEUR(r.owed)}
              </Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

function clientName(a: Appointment, clients: Client[]): string {
  if (a.client_id) {
    const c = clients.find((x) => x.id === a.client_id);
    if (c?.full_name) return c.full_name;
  }
  return a.comment?.trim() || "Без имени";
}
