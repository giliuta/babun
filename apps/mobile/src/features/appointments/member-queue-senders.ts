// ОТПРАВЩИКИ ОЧЕРЕДИ СОТРУДНИКА — по одному на вид правки.
//
// Каждый зовёт ТУ ЖЕ дверь сервера, что и правка со связью: очередь лишь
// откладывает вызов, права по блоку проверяет сервер в момент отправки.
// Повтор безопасен: новая запись и копия несут свой номер (вторая вставка —
// «уже стоит», это успех), оплата и снятие — номер запроса (сервер отдаёт уже
// записанное), правка записи ставит поля в значения, удаление уже удалённого
// — цель достигнута. Фото несут свой номер в пути файла (`photoIds`).

import type { QueryClient } from "@tanstack/react-query";
import type { Json } from "@babun/shared/db/database.types";
import {
  cancelAppointmentPayment,
  recordAppointmentPayment,
  type AppointmentPaymentKind,
} from "@babun/shared/db/repositories/appointment-payments";
import { trashAppointment } from "@babun/shared/db/repositories/deleted-appointments";
import { isTransientNetworkError } from "@babun/shared/sync/transient-error";
import { supabase } from "@/lib/supabase";
import { accessBlocksQueryKey } from "@/lib/company-query-keys";
import { clientKeys } from "@/lib/client-query-keys";
import type { MemberOpSender, MemberQueueHost } from "@/lib/member-queue/runtime";
import type { SendOutcome } from "@/lib/member-queue/plan";
import type { AccessBlock } from "@/session/access-map";
import { isOwnRecordAlreadyCreated, memberWriteRefusal } from "./member-writes";
import {
  RetryableAppointmentPhotoUploadError,
  uploadAppointmentAssets,
  type UploadAppointmentPhotosInput,
} from "./appointment-photos";
import { forgetQueuedPhotoFiles } from "./queued-photo-files";

const SENT: SendOutcome = { kind: "sent" };

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Записи уже нет или она ушла из его календарей — для удаления это цель. */
function isGone(message: string): boolean {
  return /not found|не найден/i.test(message);
}

async function rpcOrThrow(name: string, args: Record<string, unknown>): Promise<void> {
  // Имя двери — из закрытого списка видов ниже; типы RPC сюда не тянем.
  const { error } = await (supabase.rpc as unknown as (
    fn: string,
    params: Record<string, unknown>,
  ) => Promise<{ error: { message: string; code?: string } | null }>)(name, args);
  if (error) throw error;
}

const sendUpdate: MemberOpSender = async (op) => {
  await rpcOrThrow("member_appointment_update", {
    p_appointment_id: str(op.args.p_appointment_id),
    p_patch: op.args.p_patch as Json,
  });
  return SENT;
};

const sendCreate: MemberOpSender = async (op) => {
  try {
    await rpcOrThrow("member_appointment_create", { p_row: op.args.p_row as Json });
  } catch (error) {
    if (!isOwnRecordAlreadyCreated(error as { code?: string; message?: string })) throw error;
  }
  return SENT;
};

const sendCopy: MemberOpSender = async (op) => {
  try {
    await rpcOrThrow("member_appointment_copy", {
      p_source: str(op.args.p_source),
      p_date: str(op.args.p_date),
      p_time_start: str(op.args.p_time_start),
      p_time_end: str(op.args.p_time_end),
      p_id: str(op.args.p_id),
    });
  } catch (error) {
    if (!isOwnRecordAlreadyCreated(error as { code?: string; message?: string })) throw error;
  }
  return SENT;
};

const sendDelete: MemberOpSender = async (op) => {
  try {
    await rpcOrThrow("member_appointment_delete", { p_appointment_id: op.record_id });
  } catch (error) {
    if (!isGone(str((error as { message?: unknown }).message))) throw error;
  }
  return SENT;
};

const sendTrash: MemberOpSender = async (op) => {
  try {
    await trashAppointment(supabase, op.record_id);
  } catch (error) {
    if (!isGone(error instanceof Error ? error.message : String(error))) throw error;
  }
  return SENT;
};

const sendPay: MemberOpSender = async (op) => {
  await recordAppointmentPayment(supabase, {
    appointmentId: op.record_id,
    accountId: str(op.args.accountId),
    amount: Number(op.args.amount),
    requestId: str(op.args.requestId),
    kind: (str(op.args.kind) || "settlement") as AppointmentPaymentKind,
    closeVisit: op.args.closeVisit === true,
    // Деньги пришли тогда, когда мастер нажал, а не когда нашлась сеть.
    paidAt: str(op.args.paidAt) || undefined,
  });
  return SENT;
};

const sendUnpay: MemberOpSender = async (op) => {
  await cancelAppointmentPayment(supabase, {
    appointmentId: op.record_id,
    paymentId: str(op.args.paymentId),
    requestId: str(op.args.requestId),
  });
  return SENT;
};

const sendPhotos: MemberOpSender = async (op) => {
  const input = op.args.input as UploadAppointmentPhotosInput;
  try {
    await uploadAppointmentAssets({
      tenantId: op.tenant_id,
      appointmentId: op.record_id,
      input,
    });
  } catch (error) {
    if (error instanceof RetryableAppointmentPhotoUploadError && isTransientNetworkError(error)) {
      // Уехавшие уже на записи — в очереди остаётся хвост пачки.
      return {
        kind: "partial",
        args: { ...op.args, input: error.retryInput },
        error: error.message,
      };
    }
    throw error;
  }
  await forgetQueuedPhotoFiles(input.assets);
  return SENT;
};

export const MEMBER_OP_SENDERS: Readonly<Record<string, MemberOpSender>> = {
  update: sendUpdate,
  create: sendCreate,
  copy: sendCopy,
  delete: sendDelete,
  trash: sendTrash,
  pay: sendPay,
  unpay: sendUnpay,
  photos: sendPhotos,
};

/** Хозяин очереди для `startMemberQueueRuntime`: отправщики, слова отказа и
 *  что перечитать, когда вызов дошёл. */
export function memberQueueHost(qc: QueryClient): MemberQueueHost {
  return {
    senders: MEMBER_OP_SENDERS,
    describeRefusal: (_op, error) => {
      const blocks = qc.getQueryData<AccessBlock[]>(accessBlocksQueryKey());
      return (
        memberWriteRefusal(error, (key) => blocks?.find((b) => b.key === key)?.title) ??
        error.replace(/^[a-zA-Z]+:\s*/, "")
      );
    },
    onSent: (op) => {
      void qc.invalidateQueries({ queryKey: ["appointments"] });
      if (op.kind === "pay" || op.kind === "unpay" || op.kind === "update") {
        for (const key of [["transactions"], ["accounts"], ["receipts"], ["appointment-ledger"], clientKeys.all()]) {
          void qc.invalidateQueries({ queryKey: key });
        }
      }
      if (op.kind === "photos") {
        void qc.invalidateQueries({ queryKey: ["appointment-photos"] });
        void qc.invalidateQueries({ queryKey: ["client-visit-photos"] });
      }
    },
  };
}
