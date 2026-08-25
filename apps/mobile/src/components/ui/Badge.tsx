import { Text, View } from "react-native";
import type { AppointmentStatus } from "@babun/shared/local/appointments";
import { useThemeColors } from "@/theme/colors";
import { readableColorOnTint } from "./color-contrast";

export type BadgeVariant =
  | "scheduled"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "paid"
  | "partial"
  | "unpaid"
  | "refunded"
  | "neutral"
  | "brand"
  | "success"
  | "danger"
  | "warning";

// Pill styling — one light tint scale driven by semantic colors; neutral uses
// a faint surface fill.
export function Badge({
  label,
  variant = "neutral",
  color,
}: {
  label: string;
  variant?: BadgeVariant;
  /** Dynamic hue (e.g. tag color) — overrides variant with a tinted pill. */
  color?: string;
}) {
  const t = useThemeColors();

  if (color) {
    const foreground = readableColorOnTint(
      color,
      t.surface,
      t.ink,
      0x22 / 255,
    );
    return (
      <View
        style={{
          alignSelf: "flex-start",
          borderRadius: 999,
          paddingHorizontal: 8,
          paddingVertical: 2,
          backgroundColor: `${color}22`,
        }}
      >
        <Text style={{ fontSize: 11, fontWeight: "600", color: foreground }}>
          {label}
        </Text>
      </View>
    );
  }

  const base: Record<BadgeVariant, string | null> = {
    scheduled: t.accent,
    brand: t.accent,
    in_progress: t.warning,
    partial: t.warning,
    warning: t.warning,
    completed: t.success,
    paid: t.success,
    success: t.success,
    danger: t.danger,
    cancelled: null,
    unpaid: null,
    refunded: null,
    neutral: null,
  };
  const b = base[variant];
  const bg = b ? `${b}22` : "rgba(11,18,32,0.06)";
  const fg = b ?? t.sub;

  return (
    <View
      style={{
        alignSelf: "flex-start",
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 2,
        backgroundColor: bg,
      }}
    >
      <Text style={{ fontSize: 11, fontWeight: "600", color: fg }}>{label}</Text>
    </View>
  );
}

// Appointment status → RU label + variant. Single source for the calendar,
// client visits block, and appointment sheet.
export const APPT_STATUS: Record<
  AppointmentStatus,
  { label: string; variant: BadgeVariant }
> = {
  scheduled: { label: "Запланировано", variant: "scheduled" },
  in_progress: { label: "В работе", variant: "in_progress" },
  completed: { label: "Выполнено", variant: "completed" },
  cancelled: { label: "Отменено", variant: "cancelled" },
};

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  const s = APPT_STATUS[status];
  return <Badge label={s.label} variant={s.variant} />;
}
