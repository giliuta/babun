import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  calculateInvoiceTotals,
  type InvoiceLineDraft,
} from "@babun/shared/local/finance/invoice-ledger";
import {
  clientRequisitesOf,
  invoiceRequisites,
  requisitesMirror,
} from "@babun/shared/local/client-requisites";
import { useCompanies, defaultCompany } from "@/features/companies/queries";
import { useCurrentRole } from "@/features/settings/tenant";
import { buildInvoiceDocument, type InvoiceDraftSeller } from "../document";
import { invoiceDictionary } from "../dictionary";
import { parseDecimal, parseMoneyAmount } from "../format";
import { useNextInvoiceSeries } from "../queries";
import { discountAmountOf } from "./invoice-rules";
import type { InvoiceEditorProps } from "./types";
import type { useInvoiceDraft } from "./use-invoice-draft";

/** What the form adds up to and the paper it prints: the dirty flag, the
 *  chosen client and object, totals with the discount, the seller, the next
 *  number and the document mirror. */
export function useInvoicePaper({
  draft,
  clients,
  existing,
  tenant,
  businessToday,
  onDirtyChange,
}: Pick<InvoiceEditorProps, "clients" | "existing" | "tenant" | "businessToday" | "onDirtyChange"> & {
  draft: ReturnType<typeof useInvoiceDraft>;
}) {
  const {
    language, issuedOn, dueOn, clientId, setClientId, locationId, setLocationId,
    clientRequisitesId, setClientRequisitesId, appointmentId, teamId, vatMode,
    rateOverride, documentRate, companyId, accountId, notes, discountKind,
    discountValue, lines,
  } = draft;
  // ЧЕМ ДОКУМЕНТ ПОДПИШЕТСЯ — ТО И ПЕЧАТАЕТ ЗЕРКАЛО. Набор реквизитов знает
  // только справочник, а бумага собирается здесь; без этого превью печатало
  // реквизиты арендатора, а сервер подписывал выбранным набором — человек
  // подтверждал кнопкой одну бумагу, клиент получал другую (аудит бумаги
  // 2026-09-21).
  const companies = useCompanies();
  // ПАРТНЁР С «ДОКУМЕНТЫ: ВЫСТАВЛЯЕТ» (03.10): реквизиты не выбирает и не
  // правит — сервер выставляет от юрлица команды документа
  // (`issue_invoice`, миграция 20261003171500); блока «Реквизиты» у него нет,
  // и проверки реквизитов на телефоне — тоже: их скажет сервер.
  const owner = useCurrentRole().data === "owner";

  // Валюта документа — одна на компанию; форма обязана говорить в ней же,
  // а не в зашитом евро.
  const currency = tenant?.currency || "EUR";

  // ЧЕРНОВИК НЕ ПРОПАДАЕТ МОЛЧА. Форма сравнивает себя с той, какой родилась:
  // перечислять «тронутые» поля по одному — способ однажды забыть новое.
  const shape = JSON.stringify({
    issuedOn,
    dueOn,
    clientId,
    locationId,
    clientRequisitesId,
    appointmentId,
    teamId,
    vatMode,
    rateOverride,
    companyId,
    accountId,
    notes,
    discountKind,
    discountValue,
    lines: lines.map((line) => [line.title, line.description, line.qty, line.unitPrice, line.unit]),
  });
  const bornAs = useRef(shape);
  const dirty = shape !== bornAs.current;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const clientById = useMemo(
    () => new Map(clients.map((client) => [client.id, client])),
    [clients],
  );
  const selectedClient = clientId ? clientById.get(clientId) : null;
  const selectedLocation =
    selectedClient?.locations.find((loc) => loc.id === locationId) ?? null;
  // ОБЪЕКТ ВЫБИРАЮТ ТОЛЬКО НАЖАТИЕМ (владелец 2026-09-22: «выбираю клиента —
  // объект сразу не выбирается»). Смена клиента снимает объект: чужой объект
  // новому клиенту не принадлежит.
  const changeClient = (id: string | null) => {
    setClientId(id);
    if (id !== clientId) {
      setLocationId(null);
      // Реквизиты прошлого клиента новому не принадлежат — снова основной.
      setClientRequisitesId(null);
    }
  };

  const parsedLines = useMemo<InvoiceLineDraft[]>(
    () =>
      lines.map((line) => ({
        title: line.title.trim(),
        description: line.description?.trim() || null,
        qty: parseDecimal(line.qty) ?? 0,
        unit: line.unit ?? null,
        unit_price: parseMoneyAmount(line.unitPrice) ?? -1,
      })),
    [lines],
  );
  const rate = vatMode === "off" ? 0 : documentRate;
  const validLines = parsedLines.filter((line) => line.qty > 0 && line.unit_price >= 0);
  const linesSum = calculateInvoiceTotals(validLines, "off", 0).total;
  const discountAmount = discountAmountOf(linesSum, discountKind, discountValue);
  /** Строка скидки для сервера и бумаги — на языке бумаги. */
  const discountLine = useMemo<InvoiceLineDraft | null>(
    () =>
      discountAmount > 0
        ? {
            title: invoiceDictionary(language).discount,
            qty: 1,
            unit_price: -discountAmount,
            discount: true,
          }
        : null,
    [discountAmount, language],
  );
  const withDiscount = useCallback(
    (list: InvoiceLineDraft[]) => (discountLine ? [...list, discountLine] : list),
    [discountLine],
  );
  const totals = calculateInvoiceTotals(
    withDiscount(validLines),
    vatMode,
    Math.max(0, rate),
  );

  // Зеркало собирается из ТЕХ ЖЕ данных, что уедут на сервер: показываем не
  // «примерно как будет», а сам документ. В режиме правки это значит — из
  // ФОРМЫ: строки, срок, налог и комментарий берутся из состояния, и только
  // неизменяемое (номер, дата выставления, юридические снимки сторон) — из
  // выставленного документа. Витрина сохранённой версии живёт на /invoices/[id].
  const pickedCompany = useMemo(() => {
    const rows = companies.data ?? [];
    return (
      rows.filter((row) => !row.archived_at).find((row) => row.id === companyId)
      ?? defaultCompany(rows)
    );
  }, [companies.data, companyId]);
  // НОМЕР — ИЗ СЕРИИ ЭТИХ РЕКВИЗИТОВ И ГОДА ДАТЫ ВЫСТАВЛЕНИЯ (миграция
  // 20260922050000): сменил набор или год — сервер считает заново.
  const issuedYear = Number(issuedOn.slice(0, 4));
  // Партнёр — серия юрлица команды: её назовёт сервер по пустому набору.
  // Партнёру номер не спрашиваем: реквизиты документа выбирает сервер по
  // команде (у неё могут быть свои), а основная серия дала бы чужой номер.
  const series = useNextInvoiceSeries(
    issuedYear,
    owner ? (pickedCompany?.id ?? companyId) : null,
    owner && !existing,
  );
  // У выставленного счёта номер свой и не меняется: строка «Номер» печатает
  // его, а не следующий в серии.
  const nextNumber = existing ? existing.number : series.data?.number ?? undefined;
  const paperSeller: InvoiceDraftSeller | null = useMemo(() => {
    const picked = pickedCompany;
    if (!picked) return null;
    return {
      name: picked.name,
      legal_name: picked.legal_name,
      business_address: picked.business_address,
      vat_number: picked.vat_number,
      reg_number: picked.reg_number,
      iban: picked.iban,
      bank_name: picked.bank_name,
      contact_email: picked.contact_email,
      contact_phone: picked.contact_phone,
      logo_url: picked.logo_url,
    };
  }, [pickedCompany]);

  const paperDoc = useMemo(
    () =>
      buildInvoiceDocument({
            language,
            tenant,
            // Превью печатает ВЫБРАННЫЙ набор реквизитов клиента — как снимок
            // сервера (`build_invoice_client_snapshot_for`).
            client: selectedClient
              ? {
                  ...selectedClient,
                  ...requisitesMirror(
                    [invoiceRequisites(clientRequisitesOf(selectedClient), clientRequisitesId)]
                      .filter((set) => set !== null),
                  ),
                }
              : undefined,
            location: selectedLocation,
            company: paperSeller,
            draft: {
              number: nextNumber ?? "",
              issuedOn,
              dueOn,
              clientId,
              lines: withDiscount(parsedLines).map((line) => ({
                title: line.title,
                // Описание услуги печатает и выставленный документ — превью
                // обязано показать его так же (разбор 2026-09-22, баг 4).
                description: line.description ?? null,
                qty: line.qty,
                // Зеркало обязано печатать «4 м» ровно так же, как это уедет
                // на сервер: единица едет и в черновик, иначе она появлялась
                // бы только у выставленного документа.
                unit: line.unit ?? null,
                // Скидку бумага печатает минусом; у прочих строк «−1» —
                // это «цена ещё не набрана», и печатается ноль.
                unitPrice: line.discount ? line.unit_price : Math.max(0, line.unit_price),
              })),
              vatMode,
              vatPercent: Math.max(0, rate),
              subtotalNet: totals.subtotal_net,
              vatAmount: totals.vat_amount,
              total: totals.total,
              currency,
              notes,
            },
          }),
    // Пересобираем на каждое изменение формы — в этом весь смысл зеркала.
    [tenant, selectedClient, clientRequisitesId, selectedLocation, paperSeller, nextNumber, issuedOn, dueOn,
     clientId, parsedLines, vatMode, rate, totals, notes,
     currency, language, withDiscount],
  );

  return {
    companies,
    owner,
    currency,
    selectedClient,
    changeClient,
    parsedLines,
    rate,
    discountAmount,
    withDiscount,
    totals,
    pickedCompany,
    issuedYear,
    series,
    paperDoc,
  };
}
