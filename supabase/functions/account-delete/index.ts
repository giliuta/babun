import { serviceClient } from "../_shared/service-client.ts";
import { json as jsonResponse } from "../_shared/http.ts";
import { cancelSoleOwnedSubscriptions } from "../_shared/subscriptions.ts";
import { ownedTenants, purgeGoneTenantsStorage } from "../_shared/tenant-storage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  // `x-babun-tenant` клиент ставит в КАЖДЫЙ запрос (`lib/supabase.ts`): без
  // него в списке браузер отбивал предзапрос, и в вебе удаление не начиналось.
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-client-info, apikey, x-babun-tenant",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown): Response => jsonResponse(status, body, corsHeaders);


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
    // Человеку отвечаем «аккаунт не удалён» — значит, и фоновый повтор не
    // должен его удалять: строка «requested» осталась бы для него заявкой.
    const { error: dropError } = await service
      .from("account_deletion_cleanup")
      .delete()
      .eq("user_id", user.id)
      .eq("status", "requested");
    if (dropError) {
      console.error("account-delete cleanup marker drop failed", {
        userId: user.id,
        code: dropError.code,
      });
    }
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

  // Компании, где он владелец: какие из них ушли, скажет чтение после каскада.
  const ownedTenantIds = await ownedTenants(service, user.id);

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

  // ФАЙЛЫ УШЕДШИХ КОМПАНИЙ — СРАЗУ. Каскад унёс строки, а фото записей,
  // чеки, файлы клиентов и логотипы (бакет публичный) остались бы навсегда.
  // Сбой здесь удаление не останавливает: остаток подберёт `storage-janitor`.
  await purgeGoneTenantsStorage(service, ownedTenantIds);

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
