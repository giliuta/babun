import {
  DEFAULT_CURRENCY,
  isMoneyCurrency,
  money,
  moneySymbol,
  type MoneyCurrency,
} from "@babun/shared/common/utils/money";
import { useTenant } from "./tenant";

/** Валюта тенанта для экранов: код, символ и форматтеры. Реестр в money.ts
 *  кормит старые `formatEUR*`; новому коду — этот хук, чтобы экран
 *  перерисовывался вместе с профилем тенанта. */
export function useCurrency(): MoneyCurrency {
  const code = useTenant().data?.currency;
  return isMoneyCurrency(code) ? (code.toUpperCase() as MoneyCurrency) : DEFAULT_CURRENCY;
}

export function useMoney() {
  const currency = useCurrency();
  return {
    currency,
    symbol: moneySymbol(currency),
    fmt: (amount: number) => money(Math.round(amount), currency),
    fmtExact: (amount: number) => money(amount, currency),
  };
}
