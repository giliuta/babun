// Отмена подписок Stripe перед удалением аккаунта — общая для
// `account-delete` (человек жмёт «Удалить») и `account-delete-cleanup`
// (фоновый повтор): удалить аккаунт, не отменив подписку, значит оставить
// Stripe списывать тариф каждый месяц за то, чего больше нет.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.110.0";

/** Подписки, которые ещё списывают деньги. */
const LIVE_SUBSCRIPTION = new Set(["active", "trialing", "past_due", "unpaid", "incomplete"]);

/** ПОДПИСКА УХОДИТ РАНЬШЕ АККАУНТА. Аккаунт, где человек —
 *  единственный владелец, удаляется каскадом вместе с записью о подписке, а
 *  Stripe продолжал бы списывать тариф каждый месяц — и его события падали бы
 *  на удалённом аккаунте. Отменяем все живые подписки клиента Stripe (не
 *  только сохранённую: два оформления могли завести две) до первого
 *  необратимого шага. Не вышло — удаление не начинается. */
export async function cancelSoleOwnedSubscriptions(
  service: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data: owned, error: ownedError } = await service
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", userId)
    .eq("role", "owner");
  if (ownedError) return false;
  const ownedIds = (owned ?? []).map((row) => row.tenant_id as string);
  if (ownedIds.length === 0) return true;
  const { data: owners, error: ownersError } = await service
    .from("tenant_members")
    .select("tenant_id, user_id")
    .in("tenant_id", ownedIds)
    .eq("role", "owner");
  if (ownersError) return false;
  // Тот же отбор, что у `delete_sole_owned_tenants_for_account`: аккаунт с
  // другим владельцем остаётся жить — и его подписка тоже.
  const sole = ownedIds.filter(
    (id) => !(owners ?? []).some((o) => o.tenant_id === id && o.user_id !== userId),
  );
  if (sole.length === 0) return true;
  const { data: tenants, error: tenantsError } = await service
    .from("tenants")
    .select("id, stripe_customer_id, stripe_subscription_id")
    .in("id", sole);
  if (tenantsError) return false;
  const billed = (tenants ?? []).filter(
    (t) => t.stripe_customer_id || t.stripe_subscription_id,
  );
  if (billed.length === 0) return true;
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) return false;
  const headers = { Authorization: `Bearer ${key}` };
  for (const tenant of billed) {
    const ids = new Set<string>();
    if (tenant.stripe_subscription_id) ids.add(tenant.stripe_subscription_id as string);
    if (tenant.stripe_customer_id) {
      const list = await fetch(
        `https://api.stripe.com/v1/subscriptions?customer=${encodeURIComponent(
          tenant.stripe_customer_id as string,
        )}&status=all&limit=100`,
        { headers },
      );
      if (!list.ok) return false;
      const body = (await list.json().catch(() => ({}))) as {
        data?: Array<{ id?: string; status?: string }>;
      };
      for (const sub of body.data ?? []) {
        if (sub.id && sub.status && LIVE_SUBSCRIPTION.has(sub.status)) ids.add(sub.id);
      }
    }
    for (const id of ids) {
      const res = await fetch(
        `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(id)}`,
        { method: "DELETE", headers },
      );
      if (res.ok) continue;
      const failure = (await res.json().catch(() => ({}))) as {
        error?: { code?: string };
      };
      // Уже отменённая или стёртая подписка — цель достигнута.
      if (res.status === 404 || failure.error?.code === "resource_missing") continue;
      console.error("account-delete subscription cancel failed", {
        userId,
        tenantId: tenant.id,
        status: res.status,
        code: failure.error?.code,
      });
      return false;
    }
  }
  return true;
}
