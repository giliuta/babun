import { useCallback } from "react";
import { Linking, Platform } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, type Href } from "expo-router";
import { useToast } from "@/components/ui/Toast";
import { supabase } from "@/lib/supabase";
import { useCurrentRole, useTenant } from "@/features/settings/tenant";
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
  const tenant = useTenant();
  const profile = (tenant.data ?? null) as TariffProfile | null;
  const state: TariffState = {
    tier: tierOf(profile),
    paid: isPaid(profile),
    forever: !!profile?.plan_override?.trim(),
    trial: trialLeft(profile),
    trialUsed: trialUsed(profile),
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
const tariffRpc = supabase as unknown as TariffRpc;

/** Отказ двери словами: сервер говорит по-русски, клиентская обёртка — нет. */
function rpcError(error: { message?: string } | null): Error {
  return new Error(error?.message?.trim() || "Не получилось. Попробуйте ещё раз");
}

export function useStartTrial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tier: Exclude<Tier, "free">) => {
      const { error } = await tariffRpc.rpc("start_trial", { p_tier: tier });
      if (error) throw rpcError(error);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tenant"] }),
    meta: { errorHandled: true },
  });
}

export function useChooseWorkingTeams() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (teamIds: string[]) => {
      const { error } = await tariffRpc.rpc("choose_working_teams", { p_team_ids: teamIds });
      if (error) throw rpcError(error);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tenant"] }),
    meta: { errorHandled: true },
  });
}

const TARIFF_PAY_DONE_URL = "https://babun.app/pay/done";

/** Оплата тарифа — на странице Stripe в браузере (не через Apple). Функция
 *  `tariff-checkout` открывает подписку и отдаёт адрес; пока её нет на
 *  сервере, человек слышит это словами, а не «ошибка 404». */
export async function openTariffCheckout(tier: Exclude<Tier, "free">): Promise<void> {
  const web = Platform.OS === "web" && typeof window !== "undefined";
  const back = web ? `${window.location.origin}/cabinet/tariff` : TARIFF_PAY_DONE_URL;
  const { data, error } = await supabase.functions.invoke("tariff-checkout", {
    body: { tier, period: "month", return_url: back },
  });
  if (error) {
    const status = (error as { context?: { status?: number } }).context?.status;
    if (status === 404) throw new Error("Оплата тарифа скоро появится — пока работает пробный период");
    if ((error as { name?: string }).name === "FunctionsFetchError") {
      throw new Error("Нет связи с сервером оплаты. Проверьте интернет");
    }
    throw new Error("Не получилось открыть оплату. Попробуйте ещё раз");
  }
  const url = (data as { url?: string } | null)?.url;
  if (!url) throw new Error("Не получилось открыть оплату. Попробуйте ещё раз");
  if (web) window.location.assign(url);
  else await Linking.openURL(url);
}

/** ПЛАШКА «НУЖНО ИЗМЕНИТЬ ТАРИФ» (владелец 01.10): закрытое тарифом видно
 *  серым, тап поднимает плашку сверху. Владельцу — с кнопкой «Тариф»;
 *  партнёру в чужой команде менять нечего — тариф у хозяина команды. */
export function useTariffNudge() {
  const toast = useToast();
  const router = useRouter();
  const { data: role } = useCurrentRole();
  return useCallback(() => {
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
