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
    "Реквизиты не заполнены";
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
