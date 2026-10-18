/** Форма «Личная информация»: что из профиля компании попадает в поля и
 *  когда форму можно пересеять из свежего профиля. */

export type BusinessFormKey =
  | "name"
  | "city"
  | "country"
  | "contact_phone"
  | "contact_email"
  | "contact_whatsapp"
  | "legal_name"
  | "business_address"
  | "vat_number"
  | "iban"
  | "bank_name"
  | "invoice_prefix";

export type BusinessForm = Record<BusinessFormKey, string>;

export type BusinessFormSource = { id: string } & {
  [K in BusinessFormKey]?: string | null;
};

const KEYS: readonly BusinessFormKey[] = [
  "name",
  "city",
  "country",
  "contact_phone",
  "contact_email",
  "contact_whatsapp",
  "legal_name",
  "business_address",
  "vat_number",
  "iban",
  "bank_name",
  "invoice_prefix",
];

export const EMPTY_BUSINESS_FORM: BusinessForm = Object.fromEntries(
  KEYS.map((k) => [k, ""]),
) as BusinessForm;

export function businessFormFromTenant(tenant: BusinessFormSource): BusinessForm {
  const form = { ...EMPTY_BUSINESS_FORM };
  for (const k of KEYS) form[k] = tenant[k] ?? "";
  return form;
}

/** Пересевать поля можно только при смене компании или когда в форме нет
 *  несохранённого ввода. Профиль перечитывается и без «Сохранить» — логотип
 *  пишется сразу и сбрасывает кэш профиля; пересев «грязной» формы стёр бы
 *  всё, что человек успел набрать. */
export function shouldReseedBusinessForm(
  seededTenantId: string | null,
  nextTenantId: string,
  dirty: boolean,
): boolean {
  return seededTenantId !== nextTenantId || !dirty;
}
