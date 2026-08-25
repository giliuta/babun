import {
  INVOICE_GENERATOR_DEFAULTS,
  type InvoiceGeneratorSettings,
} from "@babun/shared/local/finance/invoice-generator";
import type { Tenant } from "@/features/settings/tenant";

// ПЕРЕВОДЧИК НАСТРОЕК КОМПАНИИ В ПРАВИЛА ГЕНЕРАТОРА.
//
// Сам генератор про базу ничего не знает — он берёт готовые правила и потому
// покрыт тестом без сети. Здесь единственное место, где колонки `tenants`
// превращаются в эти правила, и единственное место, где решается, что делать
// с мусором в них.
export function invoiceGeneratorSettings(
  tenant: Tenant | undefined,
): InvoiceGeneratorSettings {
  if (!tenant) return INVOICE_GENERATOR_DEFAULTS;
  return {
    // Профиль мог приехать из старой базы, где колонок ещё нет. Значение вне
    // диапазона тоже лечим здесь: подставить дефолт честнее, чем выставить
    // счёт со сроком в минус три дня.
    dueDays:
      Number.isInteger(tenant.invoice_due_days) &&
      tenant.invoice_due_days >= 0 &&
      tenant.invoice_due_days <= 365
        ? tenant.invoice_due_days
        : INVOICE_GENERATOR_DEFAULTS.dueDays,
    lineSource: tenant.invoice_line_source === "total" ? "total" : "services",
    defaultLineTitle:
      tenant.invoice_default_line_title?.trim() ||
      INVOICE_GENERATOR_DEFAULTS.defaultLineTitle,
    footerNote: tenant.invoice_footer_note ?? null,
  };
}
