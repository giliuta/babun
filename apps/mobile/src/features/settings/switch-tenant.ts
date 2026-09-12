import { supabase } from "@/lib/supabase";
import { queryClient } from "@/lib/query-client";
import { wipeTenantScopedData } from "@/lib/auth-clear";
import { pauseSyncBridgeForTenantSwitch } from "@/lib/sync-bridge";
import { pauseSyncRuntimeForTenantSwitch } from "@/lib/sync-runtime";

// ПЕРЕХОД В ДРУГУЮ КОМПАНИЮ — ОДНА ТРАНЗАКЦИЯ НА ВЕСЬ ПРОДУКТ.
//
// Человек живёт в нескольких контурах: свой личный календарь и те компании,
// куда его добавили. Переключение между ними — не «поменять переменную»: на
// активном контуре завязаны офлайн-кэш SQLite, очередь несохранённых операций,
// ключи react-query и мост синхронизации. Оставить от предыдущей компании хоть
// один из них значит показать её данные внутри другой.
//
// Порядок шагов выстрадан приёмом приглашения (он же был единственным местом,
// где продукт умел менять компанию) и здесь не меняется:
//
//   1. Остановить мост и рантайм синхронизации — чтобы в момент смены никто
//      не дописывал в кэш старую компанию.
//   2. ПЕРВАЯ чистка — до смены JWT: она уносит несохранённые операции старого
//      контура, пока они ещё принадлежат ему.
//   3. `activate_tenant` — сервер проверяет членство и переставляет
//      `app_metadata.tenant_id`.
//   4. `refreshSession` — забрать новый токен.
//   5. СВЕРКА: в новом токене действительно та компания, о которой просили.
//      Без этой строки «переключились» означало бы «попросили переключиться».
//   6. ВТОРАЯ чистка — ловит ревалидацию старого контура, которая могла
//      завершиться уже после первой, и оставляет все запросы протухшими.
//
// Дальше `SessionProvider` видит TOKEN_REFRESHED и перемонтирует обе жизни
// синхронизации уже с новым tenant id — поэтому на успехе старые НЕ
// возобновляются: возобновить их значило бы дать им дописать в новый контур.

/** Меняет активную компанию и вычищает всё, что помнило предыдущую. */
export async function switchTenant(tenantId: string): Promise<void> {
  const resumeOldBridge = pauseSyncBridgeForTenantSwitch();
  const resumeRuntime = pauseSyncRuntimeForTenantSwitch();
  let switched = false;
  try {
    await wipeTenantScopedData();

    const { error: activateError } = await supabase.rpc("activate_tenant", {
      p_tenant_id: tenantId,
    });
    if (activateError) {
      throw new Error(
        /not a member|membership/i.test(activateError.message)
          ? "Доступ к этой компании не найден."
          : activateError.message,
      );
    }

    const { data: refreshed, error: refreshError } =
      await supabase.auth.refreshSession();
    if (refreshError || !refreshed.session) {
      throw new Error(
        "Не удалось обновить вход. Проверьте интернет и повторите.",
      );
    }

    const activeTenant = (
      refreshed.session.user.app_metadata as { tenant_id?: unknown }
    ).tenant_id;
    if (activeTenant !== tenantId) {
      throw new Error("Сессия не переключилась на выбранную компанию.");
    }

    await wipeTenantScopedData();
    await queryClient.invalidateQueries();
    switched = true;
  } finally {
    if (!switched) {
      resumeRuntime();
      resumeOldBridge();
    }
  }
}
