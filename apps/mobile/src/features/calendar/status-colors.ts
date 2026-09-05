import { useCallback } from "react";
import type { Appointment } from "@babun/shared/local/appointments";
import { useThemeColors, type ThemeColors } from "@/theme/colors";

// Colors for a calendar appointment block, resolved from the fixed-light
// «Halo Cobalt» palette. Mirrors the web calendar's intent: the FILL
// is status-tinted, the left STRIPE carries identity (override → team → status).
export type BlockColors = { stripe: string; fill: string; base: string };

function statusColor(t: ThemeColors, status: Appointment["status"]): string {
  switch (status) {
    case "completed":
      return t.success;
    case "in_progress":
      return t.warning;
    case "cancelled":
      return t.faint;
    default:
      return t.accent; // scheduled
  }
}

// «Нет адреса» — валидационный сигнал веба (shared getAppointmentColorKind →
// "no_address" + AlertTriangle в AppointmentBlock): запланированная работа,
// а команда не знает, куда ехать. Порог trim < 3 — как в shared.
export function missingAddress(apt: Appointment): boolean {
  return (
    apt.kind === "work" &&
    apt.status === "scheduled" &&
    (apt.address ?? "").trim().length < 3
  );
}

// Returns a resolver so callers can also pass a team-color lookup (the stripe
// prefers the team/override hue, matching «this one's brigade Y, this one's X»).
export function useBlockColors(
  teamColorFor?: (a: Appointment) => string | null,
) {
  const t = useThemeColors();
  return useCallback(
    (apt: Appointment): BlockColors => {
      const base = statusColor(t, apt.status);
      const stripe =
        (apt.color_override as string | null | undefined) ||
        (teamColorFor ? teamColorFor(apt) : null) ||
        base;
      // ЗАЛИВКА — ЦВЕТОМ ЗАПИСИ, А НЕ СТАТУСА (владелец 2026-09-05: «хочу
      // полноценное покрытие всего, чтоб оно ярко выглядело — не только левая
      // полосочка, а внутри записи всё меняется в этот цвет»).
      //
      // Раньше блок заливался статусом на 12 %, и весь календарь был голубым:
      // «запланировано» — это девять из десяти записей, то есть заливка не
      // говорила ничего. Цвет записи, наоборот, отвечает на вопрос — чья
      // бригада, куда едут, чего не хватает (`record-color`), — и заливка
      // делает его видимым с другого конца экрана.
      //
      // СТАТУС НЕ ПОТЕРЯЛСЯ: выполненная носит зелёную галку в углу,
      // отменённая гаснет до 55 % и перечёркивается, просроченная красит
      // корешок и время янтарём. Это отдельные сигналы, а не оттенок фона.
      const fill = `${stripe}2e`;
      return { stripe, fill, base };
    },
    [t, teamColorFor],
  );
}
