import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { getAppointment } from "@babun/shared/db/repositories/appointments";
import type { TransactionDraft } from "@babun/shared/db/repositories/finance-transactions";
import type { Json } from "@babun/shared/db/database.types";
import type {
  Receipt,
  ReceiptLineSnapshot,
} from "@babun/shared/local/finance/receipt";
import { useInsertTransaction } from "@/features/finances/queries";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";

// В ТАБЛИЦУ `receipts` ПРИЛОЖЕНИЕ НЕ ПИШЕТ НИКОГДА. Номер документа назначает
// только сервер, под замком: два телефона офлайн выдали бы один и тот же
// номер. Читать — обычным запросом, выписывать — дверью `issue_receipt`
// (миграция 20260920120000), которая сама и рождает строку.
//
// ДО 2026-09-20 чек рождался САМ, триггером на каждый приход с клиентом.
// Владелец это отменил: «чек не сразу выписывается — мы выписываем его
// только тогда, когда нажмём кнопку». Отсюда и мутации ниже.

export function useReceipts(filter?: {
  clientId?: string | null;
  appointmentId?: string | null;
  /** Не спрашивать вовсе (у новой записи чеков нет — без этого флага пустой
   *  фильтр по записи тянул бы ВСЕ чеки тенанта). */
  enabled?: boolean;
}) {
  const tenantId = useTenantId();
  const clientId = filter?.clientId ?? null;
  const appointmentId = filter?.appointmentId ?? null;
  return useQuery({
    queryKey: ["receipts", tenantId, clientId, appointmentId],
    enabled: !!tenantId && filter?.enabled !== false,
    queryFn: async (): Promise<Receipt[]> => {
      let q = supabase
        .from("receipts")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .order("year", { ascending: false })
        .order("seq", { ascending: false });
      if (clientId) q = q.eq("client_id", clientId);
      if (appointmentId) q = q.eq("appointment_id", appointmentId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Receipt[];
    },
  });
}

/**
 * ЗАПИСЬ ДЛЯ ПЕРЕЧНЯ УСЛУГ ЧЕКА, КОГДА ЕЁ НЕТ ПОД РУКОЙ.
 *
 * Экраны со списком чеков (`app/documents/receipts.tsx`, `DocumentsPanel`)
 * уже держат рядом полный срез записей (`useAppointments`) и передают
 * найденную запись листу пропом — тогда `id` сюда не приходит, и хук не
 * читает ничего. Читает он только там, где лист чека открыт БЕЗ такого среза
 * — прямо со страницы записи (`AppointmentFilesBlock` намеренно не передаёт
 * её пропом, чтобы не показывать дверь «в эту же запись»), а перечень услуг
 * взять больше неоткуда.
 */
export function useReceiptAppointment(id: string | null | undefined) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["appointments", tenantId, "detail", id],
    enabled: !!tenantId && !!id,
    queryFn: () => getAppointment(supabase, id as string, tenantId as string),
  });
}

/**
 * ВЫПИСАТЬ ЧЕК ПО УЖЕ ПРОВЕДЁННЫМ ДЕНЬГАМ.
 *
 * Дверь `issue_receipt` идемпотентна: повторное нажатие на той же проводке
 * отдаёт тот же документ, второго номера не рождается. Поэтому двойной тап
 * здесь безопасен, и гасить кнопку «на всякий случай» незачем.
 */
export function useIssueReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      transactionId,
      lines,
    }: {
      transactionId: string;
      /** Перечень работ, который сервер ЗАМОРОЗИТ в чеке. `undefined` —
       *  выписка по уже проведённым деньгам, где перечень берут из записи
       *  или инвойса за спиной проводки. */
      lines?: ReceiptLineSnapshot[];
    }): Promise<Receipt> => {
      const { data, error } = await supabase.rpc("issue_receipt", {
        p_transaction_id: transactionId,
        ...(lines && lines.length > 0 ? { p_lines: lines as unknown as Json } : {}),
      });
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Чек не выписан: сервер не подтвердил документ");
      return data as unknown as Receipt;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["receipts"] });
    },
    meta: { errorHandled: true },
  });
}

/**
 * ЧЕК, СОСТАВЛЕННЫЙ С НУЛЯ: сначала ДЕНЬГИ, потом БУМАГА.
 *
 * Владелец 2026-09-20 попросил составлять чек вручную — «по клиенту, дата
 * принятия платежа… если я создаю с нуля». Решение разработчика, о котором
 * владельцу сказано словами: такой чек ВСЕГДА записывает приход на выбранный
 * счёт. Бумага без денег была бы подделкой: у клиента на руках документ, в
 * финансах — пусто.
 *
 * ПОРЯДОК ВАЖЕН И НЕОБРАТИМ. Сначала проводка (её проверяют права и правила
 * журнала), только потом дверь чека. Обратный порядок невозможен: `issue_
 * receipt` берёт готовую строку прихода и из неё же снимает сумму, налог,
 * клиента и счёт — сумма чека не приходит с устройства отдельным числом.
 *
 * ЕСЛИ ВТОРОЙ ШАГ УПАЛ, деньги остаются записанными — и это правильнее
 * отката: приход был, человек его подтвердил, и молча стирать движение денег
 * из-за неудачи с бумагой нельзя. Чек на эту же проводку выписывается второй
 * попыткой, кнопкой на самой операции.
 */
export function useComposeReceipt() {
  const insert = useInsertTransaction();
  const issue = useIssueReceipt();
  return useMutation({
    mutationFn: async ({
      draft,
      lines,
    }: {
      draft: TransactionDraft;
      lines: ReceiptLineSnapshot[];
    }): Promise<Receipt> => {
      const tx = await insert.mutateAsync(draft);
      return issue.mutateAsync({ transactionId: tx.id, lines });
    },
    meta: { errorHandled: true },
  });
}
