import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  // `x-babun-tenant` клиент ставит в КАЖДЫЙ запрос (`lib/supabase.ts`): без
  // него в списке браузер отбивал предзапрос, и в вебе удаление не начиналось.
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-client-info, apikey, x-babun-tenant",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const secretKeysJson = Deno.env.get("SUPABASE_SECRET_KEYS");
  const legacyServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  let serviceKey: string | undefined;
  if (secretKeysJson) {
    try {
      const candidates = Object.values(
        JSON.parse(secretKeysJson) as Record<string, unknown>,
      ).filter(
        (value): value is string =>
          typeof value === "string" && value.length > 20,
      );
      serviceKey =
        candidates.find((value) => value.startsWith("sb_secret_")) ??
        candidates[0];
    } catch {
      // Fall back to the legacy service-role JWT below.
    }
  }
  if (!serviceKey) serviceKey = legacyServiceKey || undefined;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Подписки, которые ещё списывают деньги. */
const LIVE_SUBSCRIPTION = new Set(["active", "trialing", "past_due", "unpaid", "incomplete"]);

/** ПОДПИСКА УХОДИТ РАНЬШЕ АККАУНТА (аудит 04.10). Аккаунт, где человек —
 *  единственный владелец, удаляется каскадом вместе с записью о подписке, а
 *  Stripe продолжал бы списывать тариф каждый месяц — и его события падали бы
 *  на удалённом аккаунте. Отменяем все живые подписки клиента Stripe (не
 *  только сохранённую: два оформления могли завести две) до первого
 *  необратимого шага. Не вышло — удаление не начинается. */
async function cancelSoleOwnedSubscriptions(
  service: NonNullable<ReturnType<typeof serviceClient>>,
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

type CleanupStatus =
  | "requested"
  | "soft_delete_failed"
  | "soft_deleted"
  | "tenant_cleanup_failed"
  | "tenant_data_deleted"
  | "pending_auth_delete";

async function markCleanup(
  service: NonNullable<ReturnType<typeof serviceClient>>,
  userId: string,
  status: CleanupStatus,
  options: { deletedTenantCount?: number; errorCode?: string | null } = {},
): Promise<boolean> {
  const { error } = await service.from("account_deletion_cleanup").upsert(
    {
      user_id: userId,
      status,
      deleted_tenant_count: Math.max(0, options.deletedTenantCount ?? 0),
      last_error_code: options.errorCode ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) {
    console.error("account-delete cleanup log failed", {
      userId,
      status,
      code: error.code,
    });
    return false;
  }
  return true;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST")
    return json(405, { error: "Method not allowed" });

  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json(401, { error: "Unauthorized" });

  const service = serviceClient();
  if (!service) return json(503, { error: "Account deletion is unavailable" });

  const { data: authData, error: authError } =
    await service.auth.getUser(token);
  const user = authData.user;
  if (authError || !user) return json(401, { error: "Unauthorized" });

  let payload: { confirmation?: unknown } = {};
  try {
    payload = await request.json();
  } catch {
    return json(400, { error: "Invalid JSON" });
  }
  const confirmation =
    typeof payload.confirmation === "string" ? payload.confirmation.trim() : "";
  const expected = user.email?.trim() || "УДАЛИТЬ";
  if (
    !confirmation ||
    confirmation.toLocaleLowerCase() !== expected.toLocaleLowerCase()
  ) {
    return json(400, { error: "Confirmation does not match" });
  }

  // Persist the recovery marker before the first irreversible operation. If
  // this table/RPC migration is not present, deletion stays unavailable and
  // no customer data is touched.
  if (!(await markCleanup(service, user.id, "requested"))) {
    return json(503, { error: "Account deletion is temporarily unavailable" });
  }

  if (!(await cancelSoleOwnedSubscriptions(service, user.id))) {
    await markCleanup(service, user.id, "requested", {
      errorCode: "SUBSCRIPTION_CANCEL_FAILED",
    });
    return json(503, { error: "Account deletion is temporarily unavailable" });
  }

  // Supabase soft deletion blocks sign-in while keeping auth.users (and its
  // membership FKs) present. It is deliberately first: business data must
  // never disappear while an active account can continue using the app.
  const { error: softDeleteError } = await service.auth.admin.deleteUser(
    user.id,
    true,
  );
  if (softDeleteError) {
    await markCleanup(service, user.id, "soft_delete_failed", {
      errorCode: "AUTH_SOFT_DELETE_FAILED",
    });
    return json(500, { error: "Could not lock account for deletion" });
  }
  await markCleanup(service, user.id, "soft_deleted");

  // One RPC = one Postgres transaction for every sole-owned tenant. A single
  // cascade error rolls all tenant deletions back. From this point onward the
  // account is already inaccessible, so failures are reported as accepted
  // cleanup work instead of asking the user to repeat an impossible flow.
  const { data: deletedTenantCount, error: tenantError } = await service.rpc(
    "delete_sole_owned_tenants_for_account",
    { p_user_id: user.id },
  );
  if (tenantError) {
    await markCleanup(service, user.id, "tenant_cleanup_failed", {
      errorCode: "TENANT_TRANSACTION_FAILED",
    });
    console.error("account-delete tenant transaction pending", {
      userId: user.id,
      code: tenantError.code,
    });
    return json(200, { ok: true, pending_cleanup: true });
  }

  const deleted =
    typeof deletedTenantCount === "number" ? deletedTenantCount : 0;
  await markCleanup(service, user.id, "tenant_data_deleted", {
    deletedTenantCount: deleted,
  });

  const { error: hardDeleteError } = await service.auth.admin.deleteUser(
    user.id,
    false,
  );
  if (hardDeleteError) {
    await markCleanup(service, user.id, "pending_auth_delete", {
      deletedTenantCount: deleted,
      errorCode: "AUTH_HARD_DELETE_FAILED",
    });
    console.error("account-delete hard delete pending", {
      userId: user.id,
      code: hardDeleteError.code,
    });
    return json(200, { ok: true, pending_cleanup: true });
  }

  // No auth row remains, so no retry is required. A stale log is harmless,
  // but remove it on the happy path to retain only actionable cleanup work.
  const { error: cleanupDeleteError } = await service
    .from("account_deletion_cleanup")
    .delete()
    .eq("user_id", user.id);
  if (cleanupDeleteError) {
    console.error("account-delete completed log cleanup failed", {
      userId: user.id,
      code: cleanupDeleteError.code,
    });
  }

  return json(200, {
    ok: true,
    pending_cleanup: false,
    deleted_tenant_count: deleted,
  });
});
