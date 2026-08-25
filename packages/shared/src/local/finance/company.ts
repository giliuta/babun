// Company settings — name, VAT registration, contact block printed on
// every invoice. One record, editable from /dashboard/settings/company.
// Kept deliberately minimal for the AirFix MVP; once the SaaS arrives
// this becomes per-tenant config read from Supabase.

export type VatMode = "inclusive" | "exclusive" | "off";

export interface CompanyInfo {
  name: string;
  legal_form: string;
  vat_number: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  /** Cyprus default 19. Stored so future jurisdictions can override. */
  vat_rate_percent: number;
  /**
   * - inclusive → the total the client paid already contains VAT (most
   *   AirFix cases — prices on the menu are all-in).
   * - exclusive → the price is net, VAT is added on the invoice.
   * - off → no VAT line rendered at all.
   */
  vat_mode: VatMode;
}

const STORAGE_KEY = "babun:company-info";

// STORY-078 leak fix — was returning {name:"AirFix", address:"Cyprus"}
// to every fresh tenant. Now empty; the owner fills via Settings.
export const DEFAULT_COMPANY: CompanyInfo = {
  name: "",
  legal_form: "",
  vat_number: "",
  address: "",
  phone: "",
  email: "",
  website: "",
  vat_rate_percent: 19,
  vat_mode: "off",
};

export function loadCompany(): CompanyInfo {
  if (typeof window === "undefined") return DEFAULT_COMPANY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_COMPANY;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_COMPANY, ...parsed } as CompanyInfo;
  } catch {
    return DEFAULT_COMPANY;
  }
}

export function saveCompany(info: CompanyInfo): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(info));
    window.dispatchEvent(new Event("babun:company-changed"));
  } catch {
    // ignore
  }
}
