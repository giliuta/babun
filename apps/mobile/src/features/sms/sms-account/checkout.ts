// SMS balance top-up through the Stripe checkout page on the website.

import { Linking, Platform } from "react-native";
import { supabase } from "@/lib/supabase";
import { TENANT_HEADER } from "@/lib/tenant-header";
import { checkoutErrorText } from "../sms-model";

/** Куда Stripe вернёт человека, платившего из приложения: страница
 *  «Оплата прошла» на сайте (без входа). */
export const SMS_PAY_DONE_URL = "https://babun.app/pay/done";

/** ОПЛАТА — ОТДЕЛЬНОЙ СТРАНИЦЕЙ STRIPE, НЕ ЧЕРЕЗ APPLE (кнопка ведёт на пополнение через отдельную страницу). На сайте страница открывается в
 *  той же вкладке и возвращает в Кабинет → SMS; в приложении — в браузере,
 *  а после возврата экран сам перечитывает баланс. */
export async function openSmsCheckout(
  amountCents: number,
  autotopup?: { thresholdCents: number },
  /** Аккаунт, ЧЕЙ баланс пополняют (блок аккаунта в Кабинете), — явно, а не
   *  тот, что открыт на телефоне. */
  tenantId?: string | null,
): Promise<void> {
  const web = Platform.OS === "web" && typeof window !== "undefined";
  const back = web ? `${window.location.origin}/cabinet/sms` : SMS_PAY_DONE_URL;
  const url = await startSmsTopup(amountCents, back, autotopup, tenantId);
  if (web) window.location.assign(url);
  else await Linking.openURL(url);
}

/** Оплата на сайте: функция открывает Stripe Checkout и отдаёт адрес.
 *  `autotopup` — эта оплата ещё и сохраняет карту: дальше баланс сам
 *  пополняется на ту же сумму, когда падает ниже порога (волна 13). */
export async function startSmsTopup(
  amountCents: number,
  returnUrl: string,
  autotopup?: { thresholdCents: number },
  tenantId?: string | null,
): Promise<string> {
  const { data, error } = await supabase.functions.invoke("sms-checkout", {
    body: {
      amount_cents: amountCents,
      return_url: returnUrl,
      ...(autotopup ? { autotopup: { threshold_cents: autotopup.thresholdCents } } : null),
    },
    ...(tenantId ? { headers: { [TENANT_HEADER]: tenantId } } : null),
  });
  if (error) throw new Error(await checkoutFailure(error));
  const url = (data as { url?: string } | null)?.url;
  if (!url) throw new Error(checkoutErrorText(null));
  return url;
}

/** Отказ функции оплаты словами: код лежит в теле ответа (`{ error }`),
 *  а сообщение самого клиента — «Edge Function returned a non-2xx…». */
async function checkoutFailure(error: unknown): Promise<string> {
  const e = error as { name?: string; context?: { clone?: () => { json: () => Promise<unknown> } } };
  if (e.name === "FunctionsFetchError") return checkoutErrorText(null, true);
  let code: string | null = null;
  try {
    const body = (await e.context?.clone?.().json()) as { error?: unknown } | undefined;
    if (typeof body?.error === "string") code = body.error;
  } catch {
    // тело не JSON — общие слова
  }
  return checkoutErrorText(code);
}
