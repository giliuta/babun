import { useCallback } from "react";
import { Linking, Platform } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, type Href } from "expo-router";
import { useToast } from "@/components/ui/Toast";
import { supabase } from "@/lib/supabase";
import { useAccountProfile, useAccountScope } from "@/session/account-scope";
import { useCurrentRole } from "@/session/tenant";
import { CAN_PAY_HERE } from "@/lib/pay-here";
import { TENANT_HEADER } from "@/lib/tenant-header";
import { useCalendarTariffs } from "@/session/calendar-tariffs";
import {
  calendarTariffState,
  tierOf,
  trialLeft,
  trialUsed,
  type BillingPeriod,
  type TariffState,
  type Tier,
} from "@/session/tiers";

// ТАРИФ — ЖИВОЙ СЛОЙ НАД ЧИСТЫМ `tiers.ts`.
//
// У аккаунта — «навсегда» и пробный: они приезжают в профиле аккаунта
// (`current_tenant_profile_safe`), и сервер там же отдаёт `tier` — платный,
// если оплачен хоть один календарь. У календаря — его подписка:
// `calendar_tariffs()` отдаёт тариф каждого календаря, который человек видит
// (владелец — все, партнёр — свои), а срок, период и отмену — владельцу и
// партнёру с правом «Тариф». Пробный — дверь сервера (`start_trial`), Stripe
// и сроки пишет только вебхук.

/** Страница тарифа календаря. Без `team` — календарь, открытый в календаре. */
export function calendarTariffHref(teamId?: string | null): Href {
  return (teamId ? `/calendar/tariff?team=${encodeURIComponent(teamId)}` : "/calendar/tariff") as Href;
}

/** Профиль аккаунта с полями тарифа. */
interface TariffProfile {
  tier?: unknown;
  plan?: string | null;
  plan_override?: string | null;
  trial_tier?: unknown;
  trial_ends_at?: string | null;
  trial_started_at?: string | null;
}

/** Тариф АККАУНТА: «навсегда», пробный и оплачен ли хоть один календарь. */
export function useTariff() {
  // Аккаунт страницы: из блока пригласившего аккаунта — его, а не того, что
  // открыт на телефоне.
  const tenant = useAccountProfile();
  const profile = (tenant.data ?? null) as TariffProfile | null;
  const tier = tierOf(profile);
  const forever = !!profile?.plan_override?.trim();
  const trial = trialLeft(profile);
  const state: TariffState = {
    tier,
    // Платный аккаунт без «навсегда» и без пробного — значит, оплачен хоть
    // один календарь.
    paid: !forever && !trial && tier != null && tier !== "free",
    forever,
    trial,
    trialUsed: trialUsed(profile),
  };
  return { loading: tenant.isPending, state };
}

/** Тариф одного календаря: состояние для подписи и страницы. Пока строки
 *  нет — `tier: null`: экран не режет, решает сервер. */
export function useCalendarTariff(teamId: string | null | undefined) {
  const account = useTariff();
  const tariffs = useCalendarTariffs();
  const row = teamId ? tariffs.data?.get(teamId) : undefined;
  return {
    // «Навсегда» и пробный — от аккаунта: подпись не ждёт тарифа календаря.
    loading: account.loading || (tariffs.isPending && !account.state.forever && !account.state.trial),
    error: tariffs.isError,
    state: calendarTariffState(account.state, row),
    periodEnd: row?.periodEnd ?? null,
  };
}

/** Дверь пробного — до наката её нет в типах базы. */
type TariffRpc = {
  rpc: (name: "start_trial", args: { p_tier: string }) => PromiseLike<{ error: { message?: string } | null }>;
};
/** Дверь пробного — под заголовком аккаунта СТРАНИЦЫ. */
const tariffRpcOf = (client: typeof supabase) => client as unknown as TariffRpc;

/** Отказ двери словами: сервер говорит по-русски, клиентская обёртка — нет. */
function rpcError(error: { message?: string } | null): Error {
  return new Error(error?.message?.trim() || "Не получилось. Попробуйте ещё раз");
}

export function useStartTrial() {
  const qc = useQueryClient();
  const { client } = useAccountScope();
  return useMutation({
    mutationFn: async (tier: Exclude<Tier, "free">) => {
      const { error } = await tariffRpcOf(client).rpc("start_trial", { p_tier: tier });
      if (error) throw rpcError(error);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tenant"] }),
    meta: { errorHandled: true },
  });
}

const TARIFF_PAY_DONE_URL = "https://babun.app/pay/done";

/** Ответы `tariff-checkout` словами владельца. */
const CHECKOUT_REFUSALS: Record<string, string> = {
  stripe_not_configured: "Оплата тарифа скоро появится — пока работает пробный период",
  forever: "Ваш тариф выдан навсегда — платить не нужно",
  no_subscription: "Подписки ещё нет — сначала оплатите календарь",
  portal_not_configured: "Управление подпиской ещё не включено — напишите нам",
  owner_only: "Тариф меняет владелец аккаунта",
  owner_only_change: "Сменить оплату действующей подписки может только владелец аккаунта",
  calendar_not_found: "Календаря нет — он в архиве или удалён",
};

/** Отказ функции: код лежит в теле ответа (`{ error }`), а сообщение самого
 *  клиента — «Edge Function returned a non-2xx…». */
async function checkoutRefusal(error: unknown): Promise<Error> {
  const e = error as {
    name?: string;
    context?: { status?: number; clone?: () => { json: () => Promise<unknown> } };
  };
  if (e.name === "FunctionsFetchError") return new Error("Нет связи с сервером оплаты. Проверьте интернет");
  if (e.context?.status === 404) return new Error(CHECKOUT_REFUSALS.stripe_not_configured);
  try {
    const body = (await e.context?.clone?.().json()) as { error?: unknown } | undefined;
    const code = typeof body?.error === "string" ? body.error : null;
    if (code && CHECKOUT_REFUSALS[code]) return new Error(CHECKOUT_REFUSALS[code]);
  } catch {
    // тело не читается — общий ответ ниже
  }
  return new Error("Не получилось открыть оплату. Попробуйте ещё раз");
}

/** Куда вернуться из Stripe: на сайте — на страницу тарифа этого
 *  календаря, в приложении — на страницу «Оплата прошла» сайта. */
function returnUrl(teamId?: string | null): { web: boolean; back: string } {
  const web = Platform.OS === "web" && typeof window !== "undefined";
  return { web, back: web ? `${window.location.origin}${calendarTariffHref(teamId) as string}` : TARIFF_PAY_DONE_URL };
}

async function openPage(url: string, web: boolean): Promise<void> {
  if (web) window.location.assign(url);
  else await Linking.openURL(url);
}

/** Оплата календаря — на странице Stripe в браузере (не через Apple).
 *  Подписки у календаря нет — открывается оплата; есть — сервер меняет её
 *  период и отвечает `changed` (тариф придёт вебхуком через несколько
 *  секунд). */
export async function openTariffCheckout(input: {
  teamId: string;
  /** Помесячно или за год. Не назван — сервер оставляет период живой
   *  подписки (новая оплата — помесячно). */
  period?: BillingPeriod;
  /** Аккаунт, ЗА КОТОРЫЙ платят, если он не тот, что открыт на телефоне. */
  tenantId?: string | null;
}): Promise<"opened" | "changed" | "same"> {
  const { web, back } = returnUrl(input.teamId);
  const { data, error } = await supabase.functions.invoke("tariff-checkout", {
    body: {
      action: "checkout",
      team_id: input.teamId,
      return_url: back,
      ...(input.period ? { period: input.period } : null),
    },
    ...(input.tenantId ? { headers: { [TENANT_HEADER]: input.tenantId } } : null),
  });
  if (error) throw await checkoutRefusal(error);
  const reply = (data ?? {}) as { url?: string; changed?: boolean };
  if (reply.url) {
    await openPage(reply.url, web);
    return "opened";
  }
  if (reply.changed === true) return "changed";
  if (reply.changed === false) return "same";
  throw new Error("Не получилось открыть оплату. Попробуйте ещё раз");
}

/** «Управление подпиской» — страница Stripe: карта, счета, отмена.
 *  `tenantId` — аккаунт страницы, если он не тот, что открыт на телефоне. */
export async function openTariffPortal(tenantId?: string | null, teamId?: string | null): Promise<void> {
  const { web, back } = returnUrl(teamId);
  const { data, error } = await supabase.functions.invoke("tariff-checkout", {
    body: { action: "portal", return_url: back },
    ...(tenantId ? { headers: { [TENANT_HEADER]: tenantId } } : null),
  });
  if (error) throw await checkoutRefusal(error);
  const url = (data as { url?: string } | null)?.url;
  if (!url) throw new Error("Не получилось открыть оплату. Попробуйте ещё раз");
  await openPage(url, web);
}

/** Слова закрытого тарифом — плашка и подсказка VoiceOver. В приложении из
 *  магазина — без призыва платить: звать к покупке там нельзя (App Store
 *  3.1.3(f), `pay-here.ts`). */
export const TARIFF_LOCKED_HINT = CAN_PAY_HERE ? "Нужно оплатить календарь" : "Недоступно для этого аккаунта";

/** ПЛАШКА «НУЖНО ОПЛАТИТЬ КАЛЕНДАРЬ»: закрытое тарифом видно серым, тап
 *  поднимает плашку сверху. Владельцу — с кнопкой «Тариф» к странице тарифа
 *  этого календаря (не назван — открытого в календаре); партнёру платить
 *  нечего — календарь оплачивает владелец. В приложении из магазина — одна
 *  спокойная фраза, без кнопки. */
export function useTariffNudge(teamId?: string | null) {
  const toast = useToast();
  const router = useRouter();
  const { data: role } = useCurrentRole();
  return useCallback(() => {
    if (!CAN_PAY_HERE) {
      toast(TARIFF_LOCKED_HINT, "info");
      return;
    }
    if (role === "owner") {
      toast("Нужно оплатить календарь", "info", {
        label: "Тариф",
        onPress: () => router.push(calendarTariffHref(teamId)),
      });
    } else {
      toast("Нужно оплатить календарь — его оплачивает владелец", "info");
    }
  }, [role, router, teamId, toast]);
}
