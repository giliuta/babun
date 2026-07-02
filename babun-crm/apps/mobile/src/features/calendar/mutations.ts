import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createAppointment,
  deleteAppointment,
  updateAppointment,
} from "@babun/shared/db/repositories/appointments";
import type { Appointment } from "@babun/shared/local/appointments";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";

// Appointment writes go through the shared repo (same as web). Completing an
// appointment triggers finance income sync server-side (sync_appointment_finance
// writes an income row with account_id), so we also invalidate the finance
// queries INCLUDING account balances.
function invalidateKeys() {
  return [["appointments"], ["transactions"], ["clients"], ["accounts"]];
}

// Fields whose change can move money server-side. A pure reschedule
// (time/date) skips the finance refetch entirely.
const FINANCE_FIELDS = [
  "status",
  "payments",
  "payment",
  "payment_status",
  "paid_amount",
  "prepaid_amount",
  "total_amount",
  "expenses",
  "client_id",
] as const satisfies readonly (keyof Appointment)[];

export function useCreateAppointment() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Appointment) =>
      createAppointment(supabase, input, tenantId as string),
    onSuccess: () => {
      for (const key of invalidateKeys()) qc.invalidateQueries({ queryKey: key });
    },
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

export function useUpdateAppointment() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Appointment> }) =>
      updateAppointment(supabase, id, patch, tenantId as string),
    // Optimistic: patch the cached list immediately so a drag-rescheduled
    // block lands on its new slot without waiting for the server round-trip.
    onMutate: async ({ id, patch }) => {
      const key = ["appointments", tenantId];
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<Appointment[]>(key);
      if (previous) {
        qc.setQueryData<Appointment[]>(
          key,
          previous.map((a) => (a.id === id ? { ...a, ...patch } : a)),
        );
      }
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(["appointments", tenantId], ctx.previous);
    },
    onSuccess: (_data, { patch }) => {
      qc.invalidateQueries({ queryKey: ["appointments"] });
      // Finance/clients refetch only when the patch can actually move money —
      // a time_start/time_end reschedule doesn't need 3 full refetches.
      if (FINANCE_FIELDS.some((f) => patch[f] !== undefined)) {
        for (const key of [["transactions"], ["clients"], ["accounts"]]) {
          qc.invalidateQueries({ queryKey: key });
        }
      }
    },
  });
}

export function useDeleteAppointment() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      deleteAppointment(supabase, id, tenantId as string),
    onSuccess: () => {
      for (const key of invalidateKeys()) qc.invalidateQueries({ queryKey: key });
    },
    meta: { errorHandled: true }, // call sites alert themselves
  });
}
