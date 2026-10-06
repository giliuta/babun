import { useCallback } from "react";
import { Linking, Platform } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, type Href } from "expo-router";
import { useToast } from "@/components/ui/Toast";
import { supabase } from "@/lib/supabase";
import { useAccountProfile, useAccountScope } from "@/features/cabinet/account-scope";
import { useCurrentRole } from "@/features/settings/tenant";
import { CAN_PAY_HERE } from "@/lib/pay-here";
import { TENANT_HEADER } from "@/lib/tenant-header";
import { tierOf, trialLeft, trialUsed, type TariffState, type Tier } from "./tiers";

// ТАРИФ АККАУНТА — ЖИВОЙ СЛОЙ НАД ЧИСТЫМ `tiers.ts`.
//
// Тариф приезжает в профиле аккаунта (`current_tenant_profile_safe` → `tier`):
// владельцу — со сроками пробного и рабочими командами, партнёру — только
// действующий тариф хозяина команды. Пробный и выбор рабочих команд — двери
// сервера (`start_trial`, `choose_working_teams`), Stripe и сроки пишет только
// сервер (сторож `tenants_guard_billing`).

export const TARIFF_HREF = "/cabinet/tariff" as Href;

/** Профиль аккаунта с полями тарифа, которых нет в типе строки до наката. */
interface TariffProfile {
  tier?: unknown;
  plan?: string | null;
  plan_override?: string | null;
  trial_tier?: unknown;
  trial_ends_at?: string | null;
  trial_started_at?: string | null;
  working_team_ids?: string[] | null;
  subscription_status?: string | null;
  current_period_end?: string | null;
}

export function useTariff() {
  // Тариф АККАУНТА СТРАНИЦЫ (04.10): в блоке пригласившего аккаунта в
  // Кабинете — его тариф, а не того, что открыт на телефоне.
  const tenant = useAccountProfile();
  const profile = (tenant.data ?? null) as TariffProfile | null;
  const state: TariffState = {
    tier: tierOf(profile),
    paid: isPaid(profile),
    forever: !!profile?.plan_override?.trim(),
    trial: trialLeft(profile),
    trialUsed: trialUsed(profile),
    pastDue: !profile?.plan_override?.trim() && profile?.subscription_status === "past_due",
  };
  return {
    loading: tenant.isPending,
    state,
    periodEnd: profile?.current_period_end ?? null,
    workingChosen: profile?.working_team_ids ?? null,
  };
}

function isPaid(profile: TariffProfile | null): boolean {
  if (!profile) return false;
  if (profile.plan_override?.trim()) return true;
  const status = profile.subscription_status;
  return (
    (profile.plan === "solo" || profile.plan === "pro" || profile.plan === "max") &&
    (status === "active" || status === "trialing" || status === "past_due")
  );
}

/** Двери тарифа — до наката их нет в типах базы. */
type TariffRpc = {
  rpc: (
    name: "start_trial" | "choose_working_teams",
    args: { p_tier: string } | { p_team_ids: string[] },
  ) => PromiseLike<{ error: { message?: string } | null }>;
};
/** Двери тарифа — под заголовком аккаунта СТРАНИЦЫ (04.10): свой аккаунт,
 *  открытый из Кабинета, пока на телефоне чужой, пробует и выбирает команды
 *  у себя, а не у того, что открыт. */
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

export function useChooseWorkingTeams() {
  const qc = useQueryClient();
  const { client } = useAccountScope();
  return useMutation({
    mutationFn: async (teamIds: string[]) => {
      const { error } = await tariffRpcOf(client).rpc("choose_working_teams", { p_team_ids: teamIds });
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
  too_many_partners: "Сначала уберите лишних партнёров — в этом тарифе их меньше",
  forever: "Ваш тариф выдан навсегда — платить не нужно",
  no_subscription: "Подписки ещё нет — сначала оплатите тариф",
  portal_not_configured: "Управление подпиской ещё не включено — напишите нам",
  owner_only: "Тариф меняет владелец аккаунта",
  owner_only_change: "Сменить тариф в действующей подписке может только владелец аккаунта",
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

function returnUrl(): { web: boolean; back: string } {
  const web = Platform.OS === "web" && typeof window !== "undefined";
  return { web, back: web ? `${window.location.origin}/cabinet/tariff` : TARIFF_PAY_DONE_URL };
}

async function openPage(url: string, web: boolean): Promise<void> {
  if (web) window.location.assign(url);
  else await Linking.openURL(url);
}

/** Оплата тарифа — на странице Stripe в браузере (не через Apple). Подписки
 *  нет — открывается оплата; есть — сервер меняет в ней тариф и отвечает
 *  `changed` (тариф придёт вебхуком через несколько секунд). */
export async function openTariffCheckout(
  tier: Exclude<Tier, "free">,
  /** Аккаунт, ЗА КОТОРЫЙ платят (блок аккаунта в Кабинете), — явно, а не
   *  тот, что открыт на телефоне (04.10). */
  tenantId?: string | null,
): Promise<"opened" | "changed" | "same"> {
  const { web, back } = returnUrl();
  const { data, error } = await supabase.functions.invoke("tariff-checkout", {
    body: { action: "checkout", tier, period: "month", return_url: back },
    ...(tenantId ? { headers: { [TENANT_HEADER]: tenantId } } : null),
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
export async function openTariffPortal(tenantId?: string | null): Promise<void> {
  const { web, back } = returnUrl();
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
 *  магазина — без призыва менять тариф: тариф там не выбирают и не
 *  оплачивают, и звать к покупке нельзя (App Store 3.1.3(f), `pay-here.ts`). */
export const TARIFF_LOCKED_HINT = CAN_PAY_HERE ? "Нужно изменить тариф" : "Недоступно для этого аккаунта";

/** ПЛАШКА «НУЖНО ИЗМЕНИТЬ ТАРИФ» (владелец 01.10): закрытое тарифом видно
 *  серым, тап поднимает плашку сверху. Владельцу — с кнопкой «Тариф»;
 *  партнёру в чужой команде менять нечего — тариф у хозяина команды. В
 *  приложении из магазина — одна спокойная фраза, без кнопки «Тариф». */
export function useTariffNudge() {
  const toast = useToast();
  const router = useRouter();
  const { data: role } = useCurrentRole();
  return useCallback(() => {
    if (!CAN_PAY_HERE) {
      toast(TARIFF_LOCKED_HINT, "info");
      return;
    }
    if (role === "owner") {
      toast("Нужно изменить тариф", "info", {
        label: "Тариф",
        onPress: () => router.push(TARIFF_HREF),
      });
    } else {
      toast("Нужно изменить тариф — его меняет владелец команды", "info");
    }
  }, [role, router, toast]);
}
