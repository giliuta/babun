import { useMutation, useQueryClient } from "@tanstack/react-query";
// STORY-062 slice 4 — appointment writes go through the offline-aware cache
// wrappers (same 3-table scope the web caches) instead of the repo directly.
// The wrapper owns the sqlite optimistic write + online/offline branch
// (online → repo; offline → enqueue op); this hook keeps its own TanStack
// `qc` optimistic layer for instant UI. Two optimistic layers (sqlite in the
// wrapper, qc here) is intentional and correct — the qc layer paints the
// dragged block onto its slot without waiting, the sqlite layer survives an
// app restart while offline.
import {
  createAppointment,
  deleteAppointment,
  updateAppointment,
} from "@babun/shared/sync/appointmentsCached";
import { randomUuid } from "@babun/shared/sync";
import type { Appointment } from "@babun/shared/local/appointments";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";

// Mirror of the wrapper's UUID guard. createBlankAppointment falls back to a
// NON-uuid `apt-…` id when `crypto.randomUUID` is missing — the RN/Hermes case
// (react-native-get-random-values only polyfills getRandomValues). We stamp a
// real RN-safe UUID before handing the blank to the offline wrapper so an
// offline create + subsequent offline edit both key on the same valid UUID:
// otherwise the edit lands in the update-op path with a non-uuid row_id and
// the replayer silently drops it, losing the edit.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      createAppointment(
        supabase,
        UUID_RE.test(input.id) ? input : { ...input, id: randomUuid() },
        tenantId as string,
      ),
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
      // Снапшот только своей записи: откат целым списком стирал бы
      // оптимистичный патч параллельной мутации соседней записи.
      return { prevRecord: previous?.find((a) => a.id === id) };
    },
    onError: (_err, { id }, ctx) => {
      const prevRecord = ctx?.prevRecord;
      if (!prevRecord) return;
      qc.setQueryData<Appointment[]>(["appointments", tenantId], (cur) =>
        cur?.map((a) => (a.id === id ? prevRecord : a)),
      );
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
