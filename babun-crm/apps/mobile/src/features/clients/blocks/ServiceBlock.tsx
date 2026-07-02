// ServiceBlock — the «Обслуживание» spine of the client card (mobile port
// of apps/web/src/components/clients/ClientServiceSpine.tsx, v813).
//
// Surfaces equipment that needs service (shared buildServiceDue →
// serviceDueState). The unit the NEXT-JOB hero already names is excluded
// (excludeUnitId) so the same fact never appears twice. Overdue rows first
// (red dot), then due-soon (amber), each with a pre-aimed «Записать ТО»;
// on-schedule units collapse to one quiet line per object. Hides itself
// entirely when there's nothing scheduled.

import { Pressable, Text, View } from "react-native";
import type { Client } from "@babun/shared/local/clients";
import type { ClientStats } from "@babun/shared/local/selectors/client-stats";
import type {
  ServiceDueSummary,
  UnitDue,
} from "@babun/shared/local/selectors/service-due";
import { useBookingNav } from "@/features/clients/card-booking";
import { useThemeColors } from "@/theme/colors";

interface ServiceBlockProps {
  client: Client;
  stats: ClientStats | undefined;
  serviceDue: ServiceDueSummary;
  /** Unit already shown in the hero — dropped here (de-dup). */
  excludeUnitId?: string | null;
}

export default function ServiceBlock({
  client,
  stats,
  serviceDue,
  excludeUnitId,
}: ServiceBlockProps) {
  const t = useThemeColors();
  const book = useBookingNav();

  const overdue = serviceDue.overdue.filter((u) => u.unitId !== excludeUnitId);
  const soon = serviceDue.soon.filter((u) => u.unitId !== excludeUnitId);
  const dueCount = overdue.length + soon.length;

  if (dueCount === 0 && serviceDue.onSchedule.length === 0) return null;

  const onBook = (locationId: string) =>
    book({
      clientId: client.id,
      locationId,
      teamId: stats?.lastTeamId ?? null,
    });

  const Row = ({ u, kind }: { u: UnitDue; kind: "over" | "soon" }) => {
    const tone = kind === "over" ? t.danger : t.warning;
    return (
      <View className="flex-row items-center gap-2.5 py-1.5">
        <View
          className="h-[7px] w-[7px] rounded-full"
          style={{ backgroundColor: tone }}
        />
        <Text
          className="flex-1 text-[15px]"
          style={{ color: t.ink }}
          numberOfLines={1}
        >
          {u.unitLabel}
        </Text>
        <Text className="text-[13px]" style={{ color: tone }}>
          {kind === "over"
            ? `−${Math.abs(u.due.daysUntil)} дн`
            : `через ${u.due.daysUntil} дн`}
        </Text>
        <Pressable
          onPress={() => onBook(u.locationId)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`Записать ТО: ${u.unitLabel}`}
          className="active:opacity-60"
        >
          <Text className="text-[13px] font-semibold" style={{ color: t.accent }}>
            Записать ТО
          </Text>
        </Pressable>
      </View>
    );
  };

  return (
    <View
      className="mx-3 mt-2 overflow-hidden rounded-2xl shadow-sm"
      style={{ backgroundColor: t.surface }}
    >
      <Text
        className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider"
        style={{ color: t.sub }}
      >
        Обслуживание
      </Text>

      {dueCount > 0 ? (
        <View className="px-4 py-1">
          {overdue.map((u) => (
            <Row key={u.unitId} u={u} kind="over" />
          ))}
          {soon.map((u) => (
            <Row key={u.unitId} u={u} kind="soon" />
          ))}
        </View>
      ) : null}

      {serviceDue.onSchedule.length > 0 ? (
        <View
          className="gap-1 px-4 py-2.5"
          style={
            dueCount > 0
              ? { borderTopWidth: 1, borderTopColor: t.separator }
              : undefined
          }
        >
          {serviceDue.onSchedule.map((o) => (
            <Text
              key={o.locationId}
              className="text-[13px]"
              style={{ color: t.faint }}
              numberOfLines={1}
            >
              {o.locationLabel} · {o.count} юнит{unitsWord(o.count)} — всё по
              графику
            </Text>
          ))}
        </View>
      ) : (
        <View className="pb-1.5" />
      )}
    </View>
  );
}

function unitsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "а";
  return "ов";
}
