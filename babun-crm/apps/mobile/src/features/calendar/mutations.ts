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
import { isOnline, randomUuid } from "@babun/shared/sync";
import type { Appointment } from "@babun/shared/local/appointments";
import {
  resetAppointmentPayment,
  setAppointmentPrepayment,
  undoAppointmentPayment,
} from "@babun/shared/db/repositories/finance-transactions";
import type { PaymentMethod } from "@babun/shared/local/finance/transaction";
import { supabase } from "@/lib/supabase";
import { preflightQuotaForCreate } from "@/lib/quota";
import { useTenantId } from "@/lib/tenant";
import { useCurrentRole } from "@/features/settings/tenant";
import { isConfirmedNetworkUnavailable } from "@/features/settings/server-read-fallback";
import { useSession } from "@/providers/SessionProvider";
import { autoAssignClientLabel } from "@/features/clients/label-auto-assign";
import { appointmentsQueryKey } from "./queries";

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
  return [
    ["appointments"],
    ["transactions"],
    ["clients"],
    ["accounts"],
    ["invoices"],
    // Чек рождается сервером на приём денег (issue_receipt_for_income):
    // оплата записи выдаёт чек, и список чеков обязан его довезти.
    ["receipts"],
  ];
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
  // Смена счёта меняет, НА КАКОЙ счёт сервер положит деньги — значит
  // финансовые срезы после неё тоже устарели.
  "payment_account_id",
] as const satisfies readonly (keyof Appointment)[];

export function useCreateAppointment() {
  const tenantId = useTenantId();
  const role = useCurrentRole().data;
  const { session } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Appointment) => {
      if (!tenantId) throw new Error("Нет активного тенанта");
      if (role !== "owner" && role !== "dispatcher") {
        throw new Error("Создавать заявки может владелец или диспетчер.");
      }
      await preflightQuotaForCreate(
        supabase,
        tenantId,
        "appointments_month",
        {
          online: isOnline(),
          isNetworkUnavailable: (error) =>
            isConfirmedNetworkUnavailable(
              error && typeof error === "object"
                ? (error as { code?: string; message?: string; details?: string })
                : { message: String(error) },
            ),
        },
      );
      const authoredInput =
        input.kind === "event" || input.kind === "personal"
          ? { ...input, created_by: session?.user.id ?? null }
          : input;
      return createAppointment(
        supabase,
        UUID_RE.test(authoredInput.id)
          ? authoredInput
          : { ...authoredInput, id: randomUuid() },
        tenantId,
      );
    },
    onSuccess: (_data, input) => {
      for (const key of invalidateKeys()) qc.invalidateQueries({ queryKey: key });
      // Метка дня → метка клиента: рабочая запись в помеченный день
      // переносит метку на клиента, пока тот в авто-режиме (city_manual).
      if (
        tenantId &&
        (role === "owner" || role === "dispatcher") &&
        input.kind !== "event" &&
        input.kind !== "personal" &&
        input.status !== "cancelled" &&
        input.client_id
      ) {
        void autoAssignClientLabel({
          supabase,
          qc,
          tenantId,
          role,
          clientId: input.client_id,
          teamId: input.team_id,
          date: input.date,
        });
      }
    },
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

export function useUpdateAppointment() {
  const tenantId = useTenantId();
  const role = useCurrentRole().data;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<Appointment>;
    }) => {
      if (role === "master") {
        const keys = Object.keys(patch);
        if (
          keys.length === 0 ||
          keys.some((key) => key !== "status" && key !== "comment")
        ) {
          throw new Error("Мастер может изменить только статус и заметку.");
        }
        const safePatch: { status?: string; comment?: string } = {};
        if (patch.status !== undefined) safePatch.status = patch.status;
        if (patch.comment !== undefined) safePatch.comment = patch.comment;
        const { data, error } = await supabase.rpc(
          "update_master_appointment_safe",
          {
            p_appointment_id: id,
            p_patch: safePatch,
          },
        );
        if (error) throw new Error(`updateAppointment: ${error.message}`);
        if (!data) throw new Error("Заявка не найдена или больше не назначена.");
        return data;
      }
      if (role !== "owner" && role !== "dispatcher") {
        throw new Error("Роль сотрудника ещё не подтверждена.");
      }
      return updateAppointment(supabase, id, patch, tenantId as string);
    },
    // Optimistic: patch the cached list immediately so a drag-rescheduled
    // block lands on its new slot without waiting for the server round-trip.
    onMutate: async ({ id, patch }) => {
      const key = appointmentsQueryKey(tenantId, role);
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
      qc.setQueryData<Appointment[]>(appointmentsQueryKey(tenantId, role), (cur) =>
        cur?.map((a) => (a.id === id ? prevRecord : a)),
      );
    },
    onSuccess: (_data, { id, patch }) => {
      qc.invalidateQueries({ queryKey: ["appointments"] });
      // Finance/clients refetch only when the patch can actually move money —
      // a time_start/time_end reschedule doesn't need 3 full refetches.
      if (FINANCE_FIELDS.some((f) => patch[f] !== undefined)) {
        for (const key of [
          ["transactions"],
          ["clients"],
          ["accounts"],
          ["invoices"],
          // Оплата в патче рождает чек на сервере — тот же закон, что у
          // invalidateKeys выше.
          ["receipts"],
        ]) {
          qc.invalidateQueries({ queryKey: key });
        }
      }
      // Метка следует за переносом («Перенести» / drag / смена клиента) —
      // то же правило, что при создании. Финальные team/date/client берём
      // из уже оптимистично пропатченного кэша.
      if (
        tenantId &&
        (role === "owner" || role === "dispatcher") &&
        (patch.date !== undefined ||
          patch.team_id !== undefined ||
          patch.client_id !== undefined)
      ) {
        const current = qc
          .getQueryData<Appointment[]>(appointmentsQueryKey(tenantId, role))
          ?.find((a) => a.id === id);
        if (
          current?.client_id &&
          current.kind !== "event" &&
          current.kind !== "personal" &&
          current.status !== "cancelled"
        ) {
          void autoAssignClientLabel({
            supabase,
            qc,
            tenantId,
            role,
            clientId: current.client_id,
            teamId: current.team_id,
            date: current.date,
          });
        }
      }
    },
  });
}

export function useDeleteAppointment() {
  const tenantId = useTenantId();
  const role = useCurrentRole().data;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => {
      if (role !== "owner" && role !== "dispatcher") {
        throw new Error("Удалять заявки может владелец или диспетчер.");
      }
      return deleteAppointment(supabase, id, tenantId as string);
    },
    onSuccess: () => {
      for (const key of invalidateKeys()) qc.invalidateQueries({ queryKey: key });
    },
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

/** Server-only because the appointment and its auto-ledger row must commit or
 * roll back together. It deliberately bypasses the offline mutation queue. */
export function useUndoAppointmentPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (appointmentId: string) =>
      undoAppointmentPayment(supabase, appointmentId),
    onSuccess: () => {
      for (const key of invalidateKeys()) qc.invalidateQueries({ queryKey: key });
    },
    meta: { errorHandled: true },
  });
}

/** Permanent payment reset. The RPC refunds every still-outstanding receipt,
 * returns the appointment to debt and recalculates an attached invoice. */
export function useResetAppointmentPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (appointmentId: string) =>
      resetAppointmentPayment(supabase, appointmentId),
    onSuccess: () => {
      for (const key of invalidateKeys()) qc.invalidateQueries({ queryKey: key });
    },
    meta: { errorHandled: true },
  });
}

/** Server-only absolute prepayment adjustment. The RPC owns both the booking
 * and every receipt/refund event, so an offline replay can never duplicate it. */
export function useSetAppointmentPrepayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      appointmentId,
      amount,
      paymentMethod,
    }: {
      appointmentId: string;
      amount: number;
      paymentMethod: PaymentMethod | null;
    }) =>
      setAppointmentPrepayment(
        supabase,
        appointmentId,
        amount,
        paymentMethod,
      ),
    onSuccess: () => {
      for (const key of invalidateKeys()) qc.invalidateQueries({ queryKey: key });
    },
    meta: { errorHandled: true },
  });
}
