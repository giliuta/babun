// Invoices repository — the platform-neutral ledger API used by mobile.
// Creation, numbering and editing are atomic database RPCs; the RN client
// performs validation too, then confirms the committed document by reading it.

import { rpcArgs } from "../rpc-args";
import type {
  InvoiceLedger,
  InvoiceLedgerWithLines,
  InvoiceLineDraft,
  InvoiceVatMode,
} from "../../local/finance/invoice-ledger";
import { calculateInvoiceTotals } from "../../local/finance/invoice-ledger";
import {
  assertInvoiceTotal,
  validateInvoiceDraft,
} from "./invoice-write-helpers";
import type { UiLocale } from "../../i18n/locales";
import {
  rowToInvoice,
  rowToLine,
  type DbSupabase,
  type LineRow,
  type Row,
} from "./invoices/mappers";
import { assertInvoiceControlRead } from "./invoices/control-read";

const INVOICE_PAGE_SIZE = 1000;

export interface IssueInvoiceDraft {
  request_id: string;
  issued_on: string;
  due_on?: string | null;
  client_id?: string | null;
  appointment_id?: string | null;
  brigade_id?: string | null;
  vat_mode: InvoiceVatMode;
  vat_percent: number;
  lines: InvoiceLineDraft[];
  notes?: string | null;
  link_to_tx_id?: string | null;
  /** Выбранные реквизиты (`companies.id`). Не задано — сервер сам подставит
   *  основные реквизиты компании (`resolve_company_id`), поэтому контрольное
   *  чтение сверяет это поле только когда черновик его явно задал. */
  company_id?: string | null;
  /** Счёт, куда клиенту предложено заплатить (`accounts.id`) — подсказка
   *  платежу, а не сам платёж. Сервер его не подставляет по умолчанию. */
  account_id?: string | null;
  /** Объект клиента (id элемента `clients.locations`, миграция
   *  20260922060000). Не задан у счёта из записи — сервер берёт её объект. */
  location_id?: string | null;
  /** Набор реквизитов клиента (id элемента `clients.requisites`, миграция
   *  20260922100000). Не задан — основной; чужой или удалённый сервер
   *  сводит к основному. */
  client_requisites_id?: string | null;
}

export async function listInvoices(
  supabase: DbSupabase,
  tenantId: string,
  opts: { limit?: number; clientId?: string } = {},
): Promise<InvoiceLedger[]> {
  const requestedLimit = opts.limit == null
    ? null
    : Math.max(0, Math.floor(opts.limit));
  if (requestedLimit === 0) return [];

  const rows: Row[] = [];
  for (let offset = 0; ; offset += INVOICE_PAGE_SIZE) {
    const remaining = requestedLimit == null
      ? INVOICE_PAGE_SIZE
      : Math.min(INVOICE_PAGE_SIZE, requestedLimit - rows.length);
    if (remaining <= 0) break;
    let q = supabase
      .from("invoices")
      .select("*")
      .eq("tenant_id", tenantId);
    if (opts.clientId) q = q.eq("client_id", opts.clientId);
    const { data, error } = await q
      .order("year", { ascending: false })
      .order("seq", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + remaining - 1);
    if (error) throw new Error(`listInvoices: ${error.message}`);
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < remaining) break;
  }
  return rows.map(rowToInvoice);
}

/** Atomically allocate a number, create the invoice and optionally link income. */
export async function issueInvoice(
  supabase: DbSupabase,
  tenantId: string,
  draft: IssueInvoiceDraft,
): Promise<InvoiceLedgerWithLines> {
  const lines = validateInvoiceDraft(draft);
  const totals = calculateInvoiceTotals(lines, draft.vat_mode, draft.vat_percent);
  assertInvoiceTotal(totals.total);
  const { data, error } = await supabase.rpc(
    "issue_invoice",
    rpcArgs<"issue_invoice">({
      p_request_id: draft.request_id,
      p_issued_on: draft.issued_on,
      p_due_on: draft.due_on ?? null,
      p_client_id: draft.client_id ?? null,
      p_appointment_id: draft.appointment_id ?? null,
      p_brigade_id: draft.brigade_id ?? null,
      p_vat_mode: draft.vat_mode,
      p_vat_percent: draft.vat_percent,
      // ОПИСАНИЕ И ЕДИНИЦА ЕДУТ НА СЕРВЕР. Их не было в этом списке, и
      // серверная функция, перечисляющая колонки поимённо, молча писала
      // строку без них: в черновике текст стоял, в выставленном счёте
      // исчезал. На проде так пропали описания всех пяти строк.
      p_lines: lines.map((line) => ({
        title: line.title,
        description: line.description ?? null,
        unit: line.unit ?? null,
        qty: line.qty,
        unit_price: line.unit_price,
        ...(line.discount ? { discount: true } : {}),
      })),
      p_notes: draft.notes?.trim() || null,
      p_link_to_tx_id: draft.link_to_tx_id ?? null,
      p_company_id: draft.company_id ?? null,
      p_account_id: draft.account_id ?? null,
      p_location_id: draft.location_id ?? null,
      // Только когда выбран НЕосновной набор: без выбора сигнатура вызова та
      // же, что до миграции 20260922100000, и счёт выставляется на базе,
      // где её ещё нет.
      ...(draft.client_requisites_id
        ? { p_client_requisites_id: draft.client_requisites_id }
        : {}),
    }),
  );
  if (error || !data || data.id !== draft.request_id || data.tenant_id !== tenantId) {
    throw new Error(`issueInvoice: ${error?.message ?? "создание не подтверждено сервером"}`);
  }
  if (draft.link_to_tx_id && data.status !== "paid") {
    throw new Error("Инвойс создан, но оплата доходом не подтверждена");
  }
  const saved = await getInvoice(supabase, data.id);
  if (!saved) {
    throw new Error("Инвойс создан, но контрольное чтение не подтверждено");
  }
  assertInvoiceControlRead(saved, lines, totals, {
    issuedOn: draft.issued_on,
    dueOn: draft.due_on ?? null,
    clientId: draft.client_id ?? null,
    appointmentId: draft.appointment_id ?? null,
    brigadeId: draft.brigade_id ?? null,
    notes: draft.notes ?? null,
    vatMode: draft.vat_mode,
    vatPercent: draft.vat_percent,
    companyId: draft.company_id ?? null,
    accountId: draft.account_id ?? null,
    allowResolvedReferences: !!draft.link_to_tx_id,
  });
  return saved;
}

export async function getInvoice(
  supabase: DbSupabase,
  id: string,
): Promise<InvoiceLedgerWithLines | null> {
  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getInvoice: ${error.message}`);
  if (!data) return null;
  const { data: lines, error: linesErr } = await supabase
    .from("invoice_lines")
    .select("*")
    .eq("invoice_id", id)
    .order("position", { ascending: true });
  if (linesErr) throw new Error(`getInvoice (lines): ${linesErr.message}`);
  return {
    ...rowToInvoice(data as Row),
    lines: ((lines ?? []) as LineRow[]).map(rowToLine),
  };
}

/**
 * ЯЗЫК БУМАГИ — ОТДЕЛЬНОЙ ЗАПИСЬЮ, И ЭТО СОЗНАТЕЛЬНО.
 *
 * `issue_invoice` его не принимает: добавить параметр к функции с одиннадцатью
 * аргументами значит создать ПЕРЕГРУЗКУ (Postgres не заменяет функцию с другой
 * сигнатурой), а старый вызов остался бы жить рядом. Язык при этом не деньги:
 * сторож `prevent_settled_invoice_rewrite` его не проверяет, и переключить его
 * можно даже у оплаченного счёта — клиент попросил английский уже после
 * выставления, и это законная просьба.
 */
export async function setInvoiceLanguage(
  supabase: DbSupabase,
  id: string,
  language: UiLocale,
): Promise<void> {
  // `.select()` — чтобы увидеть, сколько строк ушло под запись: политика строк
  // отвечает на недоступный документ «0 обновлено» без ошибки, и без сверки
  // вызывающий считал бы язык записанным.
  const { data, error } = await supabase
    .from("invoices")
    .update({ language })
    .eq("id", id)
    .select("id, language");
  if (error) throw new Error(`setInvoiceLanguage: ${error.message}`);
  const row = (data ?? [])[0] as { language?: string | null } | undefined;
  if (!row) throw new Error("setInvoiceLanguage: invoice is not writable");
  if (row.language !== language) {
    throw new Error("setInvoiceLanguage: language was not saved");
  }
}

export async function setInvoicePdfUrl(
  supabase: DbSupabase,
  id: string,
  pdfPath: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("invoices")
    .update({ pdf_url: pdfPath })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    throw new Error(`setInvoicePdfUrl: ${error?.message ?? "инвойс недоступен"}`);
  }
}

/**
 * ПРАВКА ВЫСТАВЛЕННОГО ИНВОЙСА НА МЕСТЕ (пока клиенту не отправлен, его можно
 * отредактировать). Тот же номер; сервер пускает
 * только владельца и только счёт без оплат (`update_invoice_draft`, миграция
 * 20261004060000). Реквизиты продавца не меняются — номер из их серии.
 */
export async function updateInvoice(
  supabase: DbSupabase,
  invoiceId: string,
  draft: Omit<IssueInvoiceDraft, "request_id" | "link_to_tx_id">,
): Promise<InvoiceLedgerWithLines> {
  const lines = validateInvoiceDraft(draft);
  const totals = calculateInvoiceTotals(lines, draft.vat_mode, draft.vat_percent);
  assertInvoiceTotal(totals.total);
  const { error } = await supabase.rpc(
    "update_invoice_draft",
    rpcArgs<"update_invoice_draft">({
      p_invoice_id: invoiceId,
      p_issued_on: draft.issued_on,
      p_due_on: draft.due_on ?? null,
      p_client_id: draft.client_id ?? null,
      p_appointment_id: draft.appointment_id ?? null,
      p_brigade_id: draft.brigade_id ?? null,
      p_vat_mode: draft.vat_mode,
      p_vat_percent: draft.vat_percent,
      p_lines: lines.map((line) => ({
        title: line.title,
        description: line.description ?? null,
        unit: line.unit ?? null,
        qty: line.qty,
        unit_price: line.unit_price,
        ...(line.discount ? { discount: true } : {}),
      })),
      p_notes: draft.notes?.trim() || null,
      p_account_id: draft.account_id ?? null,
      p_location_id: draft.location_id ?? null,
      p_client_requisites_id: draft.client_requisites_id ?? null,
    }),
  );
  if (error) throw new Error(error.message);
  const saved = await getInvoice(supabase, invoiceId);
  if (!saved) throw new Error("Инвойс сохранён, но контрольное чтение не подтверждено");
  return saved;
}

/**
 * УДАЛЕНИЕ ИНВОЙСА (удаление возвращает порядковый номер). Только последний в серии и без
 * оплат — сервер так и держит (`delete_invoice`); иначе — кредит-нота.
 */
export async function deleteInvoice(supabase: DbSupabase, invoiceId: string): Promise<void> {
  const { error } = await supabase.rpc("delete_invoice", { p_invoice_id: invoiceId });
  if (error) throw new Error(error.message);
}
