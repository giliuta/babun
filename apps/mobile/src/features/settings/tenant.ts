import { setDefaultCurrency } from "@babun/shared/common/utils/money";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { Database } from "@babun/shared/db/database.types";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import {
  effectivePlan,
  isUserRole,
  planAllows,
  type PlanCapability,
  type UserRole,
} from "./role-policy";
import { fetchTenantProfile } from "./company-fetchers";
import {
  currentRoleQueryKey,
  tenantQueryKey,
} from "@/lib/company-query-keys";
import { queryClient } from "@/lib/query-client";
import {
  rolePollInterval,
  subscribeSwitchRevalidation,
} from "@/lib/switch-revalidate-plan";
import { rearmRolePollers } from "@/lib/role-poll-rearm";

const ROLE_POLL_MS = 60 * 1000;

// ОПРОС РОЛИ ЗАМИРАЕТ, ПОКА ОЧЕРЕДЬ ДООБНОВЛЕНИЯ ЧИТАЕТ СЕТЬ.
//
// Раз в минуту `current_user_role` — это 60–120 вызовов в час на сессию, и
// попадая в очередь после перехода, он вставал в неё третьим к двум её
// запросам. Интервал считается функцией (`rolePollInterval`), но react-query
// пересчитывает её только когда меняются опции или запрос. Поэтому на КАЖДОЙ
// смене фазы — и на старте очереди, и на её конце — наблюдателям роли
// отдаются их же опции: старт гасит таймер, конец взводит заново. Прежний
// ранний выход «очередь идёт — не трогаем» пропускал именно старт, и опрос
// тикал сквозь очередь. Разбор и тест с настоящим таймером — `role-poll-rearm.ts`.
subscribeSwitchRevalidation(() =>
  rearmRolePollers(queryClient, currentRoleQueryKey(null)[0]),
);

type TenantUpdate = Database["public"]["Tables"]["tenants"]["Update"];

// Разбор профиля и запасной путь для старых баз живут в `company-fetchers.ts`
// чистыми — их же зовёт прогрев чужой компании. Здесь остаётся только то, что
// ОБЯЗАНО быть привязано к активной компании: валюта форматтеров.
export type { Tenant } from "./company-fetchers";

export type { UserRole } from "./role-policy";

const ROLE_LOOKUP_TIMEOUT_MS = 6_000;

function withRoleLookupTimeout<T>(work: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    Promise.resolve(work),
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Не удалось проверить роль: сеть не отвечает")),
        ROLE_LOOKUP_TIMEOUT_MS,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Ключ роли живёт в `lib/company-query-keys.ts` вместе с остальными ключами
 *  компании; здесь реэкспорт для тех, кто уже импортирует его отсюда. */
export { currentRoleQueryKey };

// Role of the signed-in user within the active tenant (tenant_members via
// the current_user_role() RPC from 20260430_008). RLS gates tenants UPDATE
// to owner only — screens use this to disable what would fail anyway.
export function useCurrentRole() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: currentRoleQueryKey(tenantId),
    enabled: !!tenantId,
    // Security gates need a terminal result even on a cold offline start.
    // Default networkMode would park this query in pending/paused forever;
    // always + a bounded request turns that into the explicit retry screen.
    networkMode: "always",
    retry: 1,
    // Membership can be revoked or changed while this device is open. Poll the
    // tiny RPC so an old owner/dispatcher surface is unmounted promptly instead
    // of keeping sensitive cached screens visible until the next app focus.
    //
    // Отзыв приезжает ОТВЕТОМ сервера, а не его отсутствием: упавший опрос
    // оставляет прошлый успешный `data` на месте, и границы прав намеренно
    // продолжают им пользоваться (fail-open, см. RoleCapabilityBoundary) —
    // иначе пропавшая сеть выкидывала бы владельца с экрана денег.
    staleTime: 30 * 1000,
    // Пауза на время тихой очереди после перехода — разбор над подпиской выше.
    refetchInterval: () => rolePollInterval(ROLE_POLL_MS),
    refetchIntervalInBackground: false,
    queryFn: async (): Promise<UserRole | null> => {
      const { data, error } = await withRoleLookupTimeout(
        supabase.rpc("current_user_role"),
      );
      if (error) throw new Error(error.message);
      if (data == null) return null;
      if (!isUserRole(data)) throw new Error("Сервер вернул неизвестную роль");
      return data;
    },
  });
}

// PostgREST surfaces an RLS refusal as a raw English message — translate
// the common case so a dispatcher/master user sees why the save failed.
function friendlyTenantError(message: string): string {
  return /row-level security/i.test(message)
    ? "Недостаточно прав: изменять профиль бизнеса может только владелец."
    : message;
}

/** Разрешает ли ТАРИФ это действие в активной компании.
 *
 *  Пока профиль не загружен, отвечает «да»: экран не имеет права мигать
 *  «нельзя → можно» на холодном старте — для человека это выглядит как
 *  сломанный продукт, а настоящий замок всё равно стоит на сервере
 *  (`enforce_plan_limits`). Канон, правило 10: экран объясняет, база решает. */
export function usePlanAllows(capability: PlanCapability): boolean {
  const tenant = useTenant().data;
  return planAllows(effectivePlan(tenant), capability);
}

export function useTenant() {
  const tenantId = useTenantId();
  const roleQuery = useCurrentRole();
  const role = roleQuery.data;
  return useQuery({
    queryKey: tenantQueryKey(tenantId, role),
    enabled: !!tenantId && roleQuery.isSuccess && role != null,
    queryFn: async () => {
      const profile = await fetchTenantProfile(
        supabase,
        tenantId as string,
        role as UserRole,
      );
      // ВАЛЮТА СТАВИТСЯ ЗДЕСЬ, А НЕ В ЧТЕНИИ, И ЭТО РЕШЕНИЕ. Хук работает только
      // для активной компании (tenantId — из устройства), поэтому валюта в
      // реестре форматтеров всегда её. Прогрев чужой компании читает тот же
      // профиль через `fetchTenantProfile` и валюты не касается — иначе экран
      // компании A печатал бы суммы в валюте B. Момент прежний: валюта
      // выставляется, когда пришёл профиль.
      setDefaultCurrency(profile?.currency);
      return profile;
    },
  });
}

export function useUpdateTenant() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: TenantUpdate) => {
      if (!tenantId) throw new Error("Нет активного тенанта");
      const { error, count } = await supabase
        .from("tenants")
        .update(patch, { count: "exact" })
        .eq("id", tenantId);
      if (error) throw new Error(friendlyTenantError(error.message));
      // RLS silently filters rows it refuses to update — 0 affected rows
      // for a non-owner is a permissions failure, not a success.
      if (count === 0)
        throw new Error(friendlyTenantError("row-level security"));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tenant"] });
      // Реквизиты и нумерация печатаются в документах: «следующий номер» и
      // предпросмотр обязаны пересчитаться сразу, а не после перезахода.
      qc.invalidateQueries({ queryKey: ["invoices"] });
    },
    meta: { errorHandled: true }, // call sites alert themselves
  });
}
