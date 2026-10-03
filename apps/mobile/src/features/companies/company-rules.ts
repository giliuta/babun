import type { Company, CompanyDraft } from "./queries";

// ПРАВИЛА НАБОРА РЕКВИЗИТОВ — ЧИСТЫЕ ФУНКЦИИ, ЧТОБЫ ИХ СТЕРЁГ ТЕСТ.
//
// Экран, лист и шторки выбора (инвойс, чек) говорят о наборе одними словами
// и чистят его одними руками: раньше страница подписывала набор именем и VAT,
// а шторка в инвойсе — адресом, и один и тот же набор выглядел по-разному.

type Described = Pick<
  Company,
  "is_default" | "archived_at" | "legal_name" | "vat_number" | "business_address"
>;

/** Что стоит на бумаге — второй строкой под именем. «Основные» первыми: это
 *  первое, что о наборе надо знать; скрытый договаривает «скрыты». */
export function companyDetail(company: Described): string {
  const paper =
    [company.legal_name, company.vat_number ? `VAT ${company.vat_number}` : null]
      .filter(Boolean)
      .join(" · ") ||
    firstLine(company.business_address) ||
    // Коротко: рядом стоит имя набора, а справа в списке — номер инвойса, и
    // «Основные · Реквизиты не заполнены» обрезалось на полуслове.
    "Не заполнены";
  const lead = company.is_default ? `Основные · ${paper}` : paper;
  return company.archived_at ? `${lead} · скрыты` : lead;
}

/** Есть ли у набора хоть что-то для бумаги, кроме внутреннего названия. */
export function companyFilled(company: Described): boolean {
  return Boolean(company.legal_name || company.vat_number || firstLine(company.business_address));
}

function firstLine(text: string | null): string {
  return (text ?? "").split("\n")[0]?.trim() ?? "";
}

/** Кому переходит звание основного, когда основной уходит из выбора: первый
 *  видимый по порядку, кроме него самого. `null` — передать некому. */
export function defaultHeir(
  companies: readonly Pick<Company, "id" | "archived_at">[],
  leavingId: string,
): string | null {
  return companies.find((c) => !c.archived_at && c.id !== leavingId)?.id ?? null;
}

/** IBAN так, как его печатают банки: заглавными, группами по четыре. */
export function formatIban(raw: string): string {
  const compact = raw.replace(/\s+/g, "").toUpperCase();
  return compact.replace(/(.{4})(?=.)/g, "$1 ");
}

const clean = (value: string | null | undefined): string | null => {
  const text = (value ?? "").trim();
  return text ? text : null;
};

// БУКВЫ И ДЛИНА НОМЕРА — У НАБОРА (владелец 03.10: «буквы и длина номера — в
// реквизитах, сразу»). Сервер держит то же правило (`legal_entities_prefix_
// format`: A–Z и цифры, до 10; `number_padding` 3…8). Сменить можно в любой
// день: номер выдаётся по порядку в серии (уникален `seq`, а не текст), так что
// дыр нет; выпущенные бумаги хранят свой номер, новые печатаются по-новому.

/** Буквы серии так, как их примет сервер: латиница заглавными и цифры. Русская
 *  раскладка и пробелы отсекаются прямо под пальцем. */
export function cleanSeriesPrefix(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
}

/** Цифр в номере — что предлагает лист. */
export const NUMBER_PADDINGS = [3, 4, 5, 6] as const;

/** Номер так, как его соберёт сервер (`format_document_number`):
 *  «INV-2026-005». Длина — не меньше самого числа. */
export function documentNumberPreview(
  prefix: string,
  year: number,
  seq: number,
  padding: number,
): string {
  const digits = String(seq);
  return `${prefix}-${year}-${digits.padStart(Math.max(padding, digits.length), "0")}`;
}

/** Пустые буквы — «не трогать»: поле не уходит в запись, сервер держит
 *  прежние. Пустой префикс сервер всё равно не примет. */
const seriesPrefix = (value: string | undefined): string | undefined => {
  const prefix = cleanSeriesPrefix(value ?? "");
  return prefix ? prefix : undefined;
};

/** Черновик перед записью. Пустое — `null`, номера — заглавными, почта —
 *  строчными, у адреса убраны пустые строки (перенос строки в нём — перенос
 *  на бумаге, лишний пустой ряд — дыра в шапке). Название набора, если его не
 *  дали, берётся из юридического имени: заставлять придумывать второе имя
 *  той же фирме незачем. */
export function normalizeCompanyDraft(draft: CompanyDraft): CompanyDraft {
  const legalName = clean(draft.legal_name);
  const address = clean(
    (draft.business_address ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n"),
  );
  const iban = clean(draft.iban);
  return {
    ...draft,
    name: clean(draft.name) ?? legalName ?? "",
    legal_name: legalName,
    business_address: address,
    vat_number: clean(draft.vat_number)?.toUpperCase() ?? null,
    reg_number: clean(draft.reg_number)?.toUpperCase() ?? null,
    iban: iban ? formatIban(iban) : null,
    bank_name: clean(draft.bank_name),
    contact_phone: clean(draft.contact_phone),
    contact_email: clean(draft.contact_email)?.toLowerCase() ?? null,
    invoice_prefix: seriesPrefix(draft.invoice_prefix),
    receipt_prefix: seriesPrefix(draft.receipt_prefix),
    credit_note_prefix: seriesPrefix(draft.credit_note_prefix),
    number_padding:
      typeof draft.number_padding === "number"
        ? Math.min(8, Math.max(3, Math.round(draft.number_padding)))
        : undefined,
  };
}

/** Можно ли сохранить: у набора должно быть хоть какое-то имя. */
export function canSaveCompany(draft: CompanyDraft): boolean {
  return normalizeCompanyDraft(draft).name.length > 0;
}

/** Правил ли человек что-то с момента открытия. Сравнение — по чистому
 *  виду: лишний пробел в конце поля не делает черновик «грязным». */
export function isCompanyDraftDirty(initial: CompanyDraft, draft: CompanyDraft): boolean {
  return (
    JSON.stringify(normalizeCompanyDraft(initial)) !==
    JSON.stringify(normalizeCompanyDraft(draft))
  );
}
