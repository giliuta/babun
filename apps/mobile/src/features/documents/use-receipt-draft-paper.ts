import {
  clientRequisitesOf,
  invoiceRequisites,
  requisitesMirror,
} from "@babun/shared/local/client-requisites";
import { useClients } from "@/features/clients/queries";
import { defaultCompany, useCompanies } from "@/features/companies/queries";
import { invoiceDictionary } from "@/features/invoices/dictionary";
import { clientParty } from "@/features/invoices/document";
import type { ReceiptDraftState } from "./ReceiptComposer";
import {
  buildDraftReceiptDocument,
  type ReceiptDocument,
  type ReceiptDocumentLineInput,
} from "./receipt-document";

// БУМАГА ЧЕРНОВИКА ЧЕКА — ИЗ ТОГО ЖЕ, ЧТО ЛЯЖЕТ В СНИМОК (04.10). Продавец —
// выбранные реквизиты, а не профиль компании: предпросмотр показывал «Giliuta»,
// а выписанный чек — «455 · VAT 555» (проверка на 17e). Получатель — правилом
// инвойса (`clientParty`): реквизиты клиента, объект.
export function useReceiptDraftPaper(input: {
  draft: ReceiptDraftState;
  numberLabel: string;
  currency: string;
  lines: readonly ReceiptDocumentLineInput[];
  discountAmount: number;
  vatRate: number;
  vatAmount: number;
  total: number;
  invoiceNumber: string | null;
}): ReceiptDocument {
  const clients = useClients();
  const companies = useCompanies();
  const { draft } = input;
  const rows = companies.data ?? [];
  const company =
    rows.find((c) => c.id === draft.companyId && !c.archived_at) ?? defaultCompany(rows);
  const client = (clients.data ?? []).find((c) => c.id === draft.clientId);
  const location = client?.locations.find((loc) => loc.id === draft.locationId) ?? null;
  const chosen = client ? invoiceRequisites(clientRequisitesOf(client), draft.clientRequisitesId) : null;
  const recipient = client
    ? clientParty(
        { ...client, ...requisitesMirror(chosen ? [chosen] : []) },
        location,
        invoiceDictionary("ru"),
      )
    : null;
  return buildDraftReceiptDocument({
    numberLabel: input.numberLabel,
    seller: {
      name: company?.legal_name || company?.name || null,
      address: company?.business_address ?? null,
      vat_number: company?.vat_number ?? null,
      reg_number: company?.reg_number ?? null,
      iban: company?.iban ?? null,
      bank_name: company?.bank_name ?? null,
    },
    recipient,
    invoiceNumber: input.invoiceNumber,
    currency: input.currency,
    issuedOn: draft.date,
    lines: input.lines,
    discountAmount: input.discountAmount,
    vatRate: input.vatRate,
    vatAmount: input.vatAmount,
    total: input.total,
  });
}
