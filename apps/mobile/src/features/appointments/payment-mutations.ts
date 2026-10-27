import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Appointment } from "@babun/shared/local/appointments";
import {
  cancelAppointmentPayment,
  recordAppointmentPayment,
  refundAppointmentOverpayment,
  type AppointmentPaymentKind,
} from "@babun/shared/db/repositories/appointment-payments";
import { cacheServerAppointment } from "@babun/shared/sync/appointmentsCached";
import { accountBalancesQueryKey } from "@/lib/company-query-keys";
import { markOwnWrite, OWN_WRITE_IN_FLIGHT_MS, OWN_WRITE_SETTLE_MS } from "@/lib/own-writes";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { useCurrentRole } from "@/session/tenant";
import { appointmentsQueryKey } from "@/features/calendar/queries";
import { NEVER_PAUSE } from "@/features/finances/accounts";
import { laterPaymentQueued, paymentScope } from "./payment-queue";
import { sendOrQueue } from "@/lib/member-queue/runtime";

/** Денежные поля записи после оплаты — их очередь кладёт поверх списка, пока
 *  оплата не дошла: перечитка иначе показала бы «не оплачено». Остальные поля
 *  записи берутся с сервера. */
const MONEY_FIELDS = [
  "payments",
  "prepayments",
  "payment",
  "paid_amount",
  "prepaid_amount",
  "payment_status",
  "payment_method",
  "payment_account_id",
  "status",
] as const satisfies readonly (keyof Appointment)[];

/** Ответы оплат, легших в очередь: это мгновенный вид, а не строка сервера —
 *  его не кладут в кэш как каноническую и деньги по нему не перечитывают. */
const queuedRows = new WeakSet<Appointment>();

/** Ответ оплаты из очереди: экран получает запись такой, какой её сделает
 *  сервер (`optimistic`). Без мгновенного вида (оплата новой записи) ответ
 *  никто не читает — хватает номера записи. */
function queuedView(appointmentId: string, optimistic: Appointment | undefined): Appointment {
  const row = optimistic ?? ({ id: appointmentId } as Appointment);
  queuedRows.add(row);
  return row;
}

function moneyView(optimistic: Appointment | undefined): Partial<Appointment> | null {
  if (!optimistic) return null;
  const view: Partial<Record<keyof Appointment, unknown>> = {};
  for (const key of MONEY_FIELDS) {
    if (optimistic[key] !== undefined) view[key] = optimistic[key];
  }
  return view as Partial<Appointment>;
}

// ДЕНЬГИ ПИШУТСЯ СРАЗУ ПО ТАПУ, без черновика. Поэтому здесь не патч записи, а
// событие: сервер сам дописывает леджер, зеркала и проводку и возвращает
// свежую строку — её кладём в кэш списка, остальные денежные ключи
// перечитываем (те же, что у useUpdateAppointment при денежном патче).
//
// `requestId` придумывает ТАП, а не мутация: один и тот же id на все повторы
// одного нажатия делает запись идемпотентной на сервере.
//
// МГНОВЕННО.
// 1. Тап кладёт в кэш запись такой, какой её сделает сервер
//    (`payment-optimistic.ts`) — плитка «оплачено» загорается сразу.
// 2. Ответ сервера заменяет её канонической строкой — И В SQLite ТОЖЕ: RPC
//    кэш телефона не трогает, и следующее чтение списка вернуло бы старую
//    строку («оплачено → не оплачено → оплачено»).
// 3. Перечитываются только деньги, которые платёж меняет: журнал, остатки
//    счетов, история платежей записи и чеки. Перечитывать после каждого тапа ВСЕ записи,
//    клиенты и инвойсы компании разом незачем.

function useSettleFreshAppointment() {
  const qc = useQueryClient();
  const tenantId = useTenantId();
  const role = useCurrentRole().data;
  return (fresh: Appointment): void => {
    // За этим ответом в очереди записи стоит следующий шаг («Снять» в
    // тосте): мгновенное снятие уже на экране, и строка «оплачено» поверх
    // него дала бы мигание. Каноническую строку положит ответ последнего
    // (`payment-queue.ts`).
    if (!laterPaymentQueued(qc, fresh.id)) {
      qc.setQueryData<Appointment[]>(appointmentsQueryKey(tenantId, role), (cur) =>
        cur?.map((a) => (a.id === fresh.id ? fresh : a)),
      );
      if (tenantId) void cacheServerAppointment(fresh, tenantId).catch(() => {});
    }
    void qc.invalidateQueries({ queryKey: ["transactions"] });
    void qc.invalidateQueries({ queryKey: ["appointment-ledger"] });
    void qc.invalidateQueries({ queryKey: accountBalancesQueryKey(tenantId) });
    void qc.invalidateQueries({ queryKey: ["receipts"] });
  };
}

/** Тап — в кэш сразу; отказ сервера — прежняя запись назад. */
function useOptimisticPatch() {
  const qc = useQueryClient();
  const tenantId = useTenantId();
  const role = useCurrentRole().data;
  const key = appointmentsQueryKey(tenantId, role);
  return {
    apply: (optimistic: Appointment | undefined): { previous?: Appointment } => {
      if (!optimistic) return {};
      const previous = qc
        .getQueryData<Appointment[]>(key)
        ?.find((a) => a.id === optimistic.id);
      // Летящее чтение списка не должно затереть мгновенную запись.
      void qc.cancelQueries({ queryKey: key });
      qc.setQueryData<Appointment[]>(key, (cur) =>
        cur?.map((a) => (a.id === optimistic.id ? optimistic : a)),
      );
      return { previous };
    },
    revert: (context: { previous?: Appointment } | undefined): void => {
      const previous = context?.previous;
      if (!previous) return;
      qc.setQueryData<Appointment[]>(key, (cur) =>
        cur?.map((a) => (a.id === previous.id ? previous : a)),
      );
      // В очереди «оплата → снятие» прежняя строка снятия — это мгновенная
      // оплата, а не база: отказ перечитывает список, чтобы на экране
      // осталась правда сервера. Только на отказе — редкий путь.
      void qc.invalidateQueries({ queryKey: key });
    },
  };
}

export interface RecordPaymentVars {
  appointmentId: string;
  accountId: string;
  /** Евро с копейками. */
  amount: number;
  requestId: string;
  kind?: AppointmentPaymentKind;
  closeVisit?: boolean;
  /** Запись такой, какой её сделает сервер, — в кэш по тапу. */
  optimistic?: Appointment;
}

/** `appointmentId` — очередь денег этой записи (`payment-queue.ts`); у новой
 *  записи её нет — платёж там один и уходит после создания. */
export function useRecordPayment(appointmentId?: string | null) {
  const settle = useSettleFreshAppointment();
  const patch = useOptimisticPatch();
  const tenantId = useTenantId();
  const role = useCurrentRole().data;
  return useMutation({
    ...NEVER_PAUSE,
    scope: paymentScope(appointmentId),
    onMutate: (vars: RecordPaymentVars) => {
      markOwnWrite(vars.appointmentId, OWN_WRITE_IN_FLIGHT_MS);
      return patch.apply(vars.optimistic);
    },
    onError: (_error, _vars, context) => patch.revert(context),
    onSettled: (_data, _error, vars) => markOwnWrite(vars.appointmentId, OWN_WRITE_SETTLE_MS),
    mutationFn: async (vars: RecordPaymentVars): Promise<Appointment> => {
      const input = {
        appointmentId: vars.appointmentId,
        accountId: vars.accountId,
        amount: vars.amount,
        requestId: vars.requestId,
        kind: vars.kind,
        closeVisit: vars.closeVisit,
        paidAt: new Date().toISOString(),
      };
      if (role !== "master" || !tenantId) return recordAppointmentPayment(supabase, input);
      // Сотрудник без сети: оплата ждёт в очереди телефона и уйдёт той же
      // дверью, повтор узнаётся по `requestId` (`lib/member-queue`).
      const sent = await sendOrQueue({
        tenantId,
        recordId: vars.appointmentId,
        kind: "pay",
        args: { ...input, view: moneyView(vars.optimistic) },
        label: "Оплата записи",
        send: () => recordAppointmentPayment(supabase, input),
      });
      return sent.queued ? queuedView(vars.appointmentId, vars.optimistic) : sent.data;
    },
    onSuccess: (data) => {
      if (!queuedRows.has(data)) settle(data);
    },
  });
}

export interface CancelPaymentVars {
  appointmentId: string;
  paymentId: string;
  requestId: string;
  optimistic?: Appointment;
}

export function useCancelPayment(appointmentId?: string | null) {
  const settle = useSettleFreshAppointment();
  const patch = useOptimisticPatch();
  const tenantId = useTenantId();
  const role = useCurrentRole().data;
  return useMutation({
    ...NEVER_PAUSE,
    scope: paymentScope(appointmentId),
    onMutate: (vars: CancelPaymentVars) => {
      markOwnWrite(vars.appointmentId, OWN_WRITE_IN_FLIGHT_MS);
      return patch.apply(vars.optimistic);
    },
    onError: (_error, _vars, context) => patch.revert(context),
    onSettled: (_data, _error, vars) => markOwnWrite(vars.appointmentId, OWN_WRITE_SETTLE_MS),
    mutationFn: async (vars: CancelPaymentVars): Promise<Appointment> => {
      const input = {
        appointmentId: vars.appointmentId,
        paymentId: vars.paymentId,
        requestId: vars.requestId,
      };
      if (role !== "master" || !tenantId) return cancelAppointmentPayment(supabase, input);
      const sent = await sendOrQueue({
        tenantId,
        recordId: vars.appointmentId,
        kind: "unpay",
        args: { ...input, view: moneyView(vars.optimistic) },
        label: "Снятие оплаты",
        send: () => cancelAppointmentPayment(supabase, input),
      });
      return sent.queued ? queuedView(vars.appointmentId, vars.optimistic) : sent.data;
    },
    onSuccess: (data) => {
      if (!queuedRows.has(data)) settle(data);
    },
  });
}

export interface RefundOverpaymentVars {
  appointmentId: string;
  /** Евро с копейками. */
  amount: number;
  requestId: string;
}

/** ВЕРНУТЬ КЛИЕНТУ ПЕРЕПЛАТУ. Итог записи опустили ниже
 *  полученного: перед сохранением разницу возвращают клиенту — в финансах
 *  «Возврат клиенту», платежи записи уменьшаются. Без мгновенного вида:
 *  ответ нужен форме, чтобы следом сохранить итог. */
export function useRefundOverpayment(appointmentId?: string | null) {
  const settle = useSettleFreshAppointment();
  return useMutation({
    ...NEVER_PAUSE,
    scope: paymentScope(appointmentId),
    onMutate: (vars: RefundOverpaymentVars) => {
      markOwnWrite(vars.appointmentId, OWN_WRITE_IN_FLIGHT_MS);
    },
    onSettled: (_data, _error, vars) => markOwnWrite(vars.appointmentId, OWN_WRITE_SETTLE_MS),
    mutationFn: (vars: RefundOverpaymentVars) =>
      refundAppointmentOverpayment(supabase, {
        appointmentId: vars.appointmentId,
        amount: vars.amount,
        requestId: vars.requestId,
      }),
    onSuccess: settle,
  });
}
