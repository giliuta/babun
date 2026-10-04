import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { NEVER_PAUSE } from "@/features/finances/accounts";
import { getAppointment } from "@babun/shared/db/repositories/appointments";
import type { TransactionDraft } from "@babun/shared/db/repositories/finance-transactions";
import type { Json } from "@babun/shared/db/database.types";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import type {
  Receipt,
  ReceiptLineSnapshot,
} from "@babun/shared/local/finance/receipt";
import { invalidateLedger, useInsertTransaction } from "@/features/finances/queries";
import { randomUuid } from "@babun/shared/sync";
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

/** Сколько чеков читать за один заход: предел PostgREST — тысяча строк. */
const RECEIPTS_PAGE = 1000;

export function useReceipts(filter?: {
  clientId?: string | null;
  appointmentId?: string | null;
  /** Чеки платежей одного инвойса — его страница (чек бывает только у
   *  инвойса, владелец 2026-09-30). */
  invoiceId?: string | null;
  /** …и чеки на ЕГО ПЛАТЕЖИ, выписанные до того, как у денег появился
   *  инвойс (аудит 03.10): такой чек несёт `transaction_id`, а `invoice_id`
   *  у него пуст — выпуск инвойса по доходу чек к себе не привязывает. Без
   *  этого чек на странице инвойса не появлялся, «Выписать чек» стоял
   *  навсегда, а сервер на нажатие возвращал старый чек. */
  transactionIds?: readonly string[];
  /** Не спрашивать вовсе (у новой записи чеков нет — без этого флага пустой
   *  фильтр по записи тянул бы ВСЕ чеки тенанта). */
  enabled?: boolean;
}) {
  const tenantId = useTenantId();
  const clientId = filter?.clientId ?? null;
  const appointmentId = filter?.appointmentId ?? null;
  const invoiceId = filter?.invoiceId ?? null;
  const transactionIds = [...(filter?.transactionIds ?? [])].sort();
  return useQuery({
    queryKey: ["receipts", tenantId, clientId, appointmentId, invoiceId, transactionIds.join(",")],
    enabled: !!tenantId && filter?.enabled !== false,
    queryFn: async (): Promise<Receipt[]> => {
      // ПОСТРАНИЧНО (аудит финансов 2026-09-30): PostgREST отдаёт не больше
      // тысячи строк за ответ, и тысяча первый чек молча не попадал ни в
      // «Документы», ни в поиск. Порядок однозначный — с `id` последним
      // ключом, — иначе соседние страницы теряли бы и повторяли строки.
      const rows: Receipt[] = [];
      for (let from = 0; ; from += RECEIPTS_PAGE) {
        let q = supabase
          .from("receipts")
          .select("*")
          .eq("tenant_id", tenantId as string)
          .order("year", { ascending: false })
          .order("seq", { ascending: false })
          .order("id", { ascending: true });
        if (clientId) q = q.eq("client_id", clientId);
        if (appointmentId) q = q.eq("appointment_id", appointmentId);
        if (invoiceId && transactionIds.length > 0) {
          q = q.or(`invoice_id.eq.${invoiceId},transaction_id.in.(${transactionIds.join(",")})`);
        } else if (invoiceId) {
          q = q.eq("invoice_id", invoiceId);
        }
        const { data, error } = await q.range(from, from + RECEIPTS_PAGE - 1);
        if (error) throw new Error(error.message);
        const page = (data ?? []) as unknown as Receipt[];
        rows.push(...page);
        if (page.length < RECEIPTS_PAGE) break;
      }
      return rows;
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
    ...NEVER_PAUSE,
    mutationFn: async ({
      transactionId,
      lines,
      companyId,
      issuedOn,
      locationId,
      clientRequisitesId,
    }: {
      transactionId: string;
      /** Чьими реквизитами подписан чек; не передан — основными. */
      companyId?: string | null;
      /** Дата чека; не передана — день оплаты (04.10, «дата — как в инвойсе»). */
      issuedOn?: string | null;
      /** Объект и реквизиты клиента — как у инвойса. */
      locationId?: string | null;
      clientRequisitesId?: string | null;
      /** Перечень работ, который сервер ЗАМОРОЗИТ в чеке. `undefined` —
       *  выписка по уже проведённым деньгам, где перечень берут из записи
       *  или инвойса за спиной проводки. */
      lines?: ReceiptLineSnapshot[];
    }): Promise<Receipt> => {
      const { data, error } = await supabase.rpc("issue_receipt", {
        p_transaction_id: transactionId,
        ...(lines && lines.length > 0 ? { p_lines: lines as unknown as Json } : {}),
        ...(companyId ? { p_company_id: companyId } : {}),
        ...(issuedOn ? { p_issued_on: issuedOn } : {}),
        ...(locationId ? { p_location_id: locationId } : {}),
        ...(clientRequisitesId ? { p_client_requisites_id: clientRequisitesId } : {}),
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
    ...NEVER_PAUSE,
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

/**
 * ПРОВОДКА, НА КОТОРУЮ ВЫПИСЫВАЮТ ЧЕК (владелец 2026-10-03: чек по оплаченной
 * записи и по оплаченному инвойсу). Одна строка журнала — её клиент, счёт,
 * дата и сумма станут чеком.
 */
export function useReceiptTransaction(id: string | null | undefined) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["receipt-transaction", tenantId, id],
    enabled: !!tenantId && !!id,
    queryFn: async (): Promise<FinanceTransaction | null> => {
      const { data, error } = await supabase
        .from("finance_transactions")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .eq("id", id as string)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data ?? null) as unknown as FinanceTransaction | null;
    },
  });
}

/** Один чек — для его правки (`/documents/receipt-new?receiptId=`). */
export function useReceipt(id: string | null | undefined) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["receipts", tenantId, "one", id],
    enabled: !!tenantId && !!id,
    queryFn: async (): Promise<Receipt | null> => {
      const { data, error } = await supabase
        .from("receipts")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .eq("id", id as string)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data ?? null) as unknown as Receipt | null;
    },
  });
}

/**
 * ПРАВКА ВЫПИСАННОГО ЧЕКА НА МЕСТЕ (владелец 2026-10-04: «выписал чек, увидел
 * мелочь, клиенту ещё не отправлял — сразу отредактирую и отправлю»). Тот же
 * номер; сумма, счёт и клиент — от оплаты и не меняются (`update_receipt`).
 */
export function useUpdateReceipt() {
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: async (input: {
      receiptId: string;
      lines: ReceiptLineSnapshot[];
      issuedOn: string;
      locationId: string | null;
      clientRequisitesId: string | null;
    }): Promise<Receipt> => {
      const { data, error } = await supabase.rpc("update_receipt", {
        p_receipt_id: input.receiptId,
        p_lines: input.lines as unknown as Json,
        p_issued_on: input.issuedOn,
        ...(input.locationId ? { p_location_id: input.locationId } : {}),
        ...(input.clientRequisitesId ? { p_client_requisites_id: input.clientRequisitesId } : {}),
      });
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Чек не сохранён: сервер не подтвердил документ");
      return data as unknown as Receipt;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["receipts"] });
    },
    meta: { errorHandled: true },
  });
}

/**
 * ВОЗВРАТ ПО ЧЕКУ — ДЕНЬГИ И КРЕДИТ-НОТА ОДНИМ ДВИЖЕНИЕМ (владелец 2026-10-04:
 * «вернули деньги — нужен документ»). Сервер (`refund_receipt`) пишет возврат
 * и выписывает ноту: к чеку — на сумму возврата, к инвойсу — целиком.
 * Возвращает выписанную кредит-ноту.
 */
export function useRefundReceipt() {
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: async (input: {
      receiptId: string;
      amount: number;
      reason: string | null;
      language: string;
      requestId?: string;
    }): Promise<{ id: string; number: string }> => {
      const { data, error } = await supabase.rpc("refund_receipt", {
        p_receipt_id: input.receiptId,
        p_request_id: input.requestId ?? randomUuid(),
        p_amount: input.amount,
        ...(input.reason ? { p_reason: input.reason } : {}),
        p_language: input.language,
      });
      if (error) throw new Error(error.message);
      if (!data) throw new Error("Возврат не подтверждён сервером");
      return { id: data.id, number: data.number };
    },
    onSuccess: () => invalidateLedger(qc),
    meta: { errorHandled: true },
  });
}

/** УДАЛЕНИЕ ПОСЛЕДНЕГО ЧЕКА СЕРИИ — номер возвращается, деньги остаются
 *  (владелец 04.10: «чек тоже нужно удалить»; `delete_receipt`). */
export function useDeleteReceipt() {
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: async (receiptId: string) => {
      const { error } = await supabase.rpc("delete_receipt", { p_receipt_id: receiptId });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => invalidateLedger(qc),
    meta: { errorHandled: true },
  });
}
