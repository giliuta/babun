import {
  INVOICE_GENERATOR_DEFAULTS,
  type InvoiceGeneratorSettings,
} from "@babun/shared/local/finance/invoice-generator";
import { invoiceDictionary, type InvoiceLanguage } from "@/lib/paper/dictionary";
import type { Tenant } from "@/session/tenant";

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

/** Название строки «одной строкой» на языке бумаги.
 *
 *  В базе у каждой компании лежит дефолт колонки — русское «Услуги»: его
 *  никто не выбирал, поэтому он переводится на язык документа. Своё название
 *  компании (любое другое) печатается как есть — это её слова. */
export function paperLineTitle(
  companyTitle: string,
  language: InvoiceLanguage,
): string {
  const own = companyTitle.trim();
  return own && own !== /* i18n-ignore */ "Услуги"
    ? own
    : invoiceDictionary(language).servicesLine;
}
