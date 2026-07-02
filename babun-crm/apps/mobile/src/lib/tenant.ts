import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getStorage } from "@babun/shared/storage";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/providers/SessionProvider";

// Tenant resolution + onboarding gate — mobile port of the web logic in
// apps/web/src/lib/supabase/tenant-context.ts and apps/web/src/app/dashboard/
// layout.tsx (STORY-039/040/079).
//
// Resolution chain for the active tenant id:
//   1. JWT app_metadata.tenant_id (stamped by the handle_new_user trigger) —
//      covers every existing user, zero network.
//   2. MMKV cache from a previous successful lookup (offline cold starts).
//   3. tenant_members lookup by user_id (web fallback parity) — covers fresh
//      users whose JWT predates the stamp and invited members.
//
// The onboarding gate is deliberately asymmetric (STORY-079 semantics):
//   fail-OPEN  → transient lookup errors ("unknown") land in the dashboard,
//                never on the onboarding wizard: a network blip must not
//                throw a configured owner out of the app;
//   fail-CLOSED→ only a CONFIRMED missing membership / tenant row / NULL
//                onboarded_at routes to (auth)/onboarding.

// ---------------------------------------------------------------------------
// Local cache (MMKV via the shared KV seam). Keys sit under the "babun:"
// prefix so the auth-clear wipe (src/lib/auth-clear.ts TENANT_PREFIXES)
// removes them on account switch.

const tenantIdCacheKey = (userId: string) => `babun:tenant:id:${userId}`;
const onboardedStampKey = (tenantId: string) => `babun:tenant:onboarded:${tenantId}`;

// MMKV opens lazily and can throw while the Keychain is still locked (iOS
// prewarm) — the cache is an optimisation, never let it crash a render.
function readCache(key: string): string | null {
  try {
    return getStorage().getRaw(key);
  } catch {
    return null;
  }
}

function writeCache(key: string, value: string): void {
  try {
    getStorage().setRaw(key, value);
  } catch {
    // cache only — the query result still drives this session
  }
}

function removeCache(key: string): void {
  try {
    getStorage().remove(key);
  } catch {
    // cache only
  }
}

/** Positive local stamp «этот tenant уже прошёл онбординг». Exported for the
 *  onboarding screen so completion flips the gate without a refetch. */
export function stampOnboarded(tenantId: string): void {
  writeCache(onboardedStampKey(tenantId), "1");
}

// ---------------------------------------------------------------------------
// Bounded gate queries: supabase-js has no fetch timeout on RN, and the root
// navigator holds the splash screen while the gate is "loading" — a hung
// request must resolve into fail-open, not a stuck launch.

const GATE_TIMEOUT_MS = 6_000;

function withTimeout<T>(work: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    Promise.resolve(work),
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Превышено время ожидания сети")),
        GATE_TIMEOUT_MS,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

// networkMode "online" (default) parks queries in `pending/paused` while the
// device is offline — for the gate that's a transient state, not "loading".
function isPaused(q: { isPending: boolean; fetchStatus: string }): boolean {
  return q.isPending && q.fetchStatus === "paused";
}

// ---------------------------------------------------------------------------
// Tenant id resolution (JWT → MMKV → tenant_members).

export const tenantMembershipKey = (userId: string | null) =>
  ["tenant-membership", userId] as const;

function useTenantResolution() {
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const jwtTenantId =
    (session?.user.app_metadata as { tenant_id?: string } | undefined)
      ?.tenant_id ?? null;
  const cachedTenantId =
    userId && !jwtTenantId ? readCache(tenantIdCacheKey(userId)) : null;
  const knownTenantId = jwtTenantId ?? cachedTenantId;

  const membership = useQuery({
    queryKey: tenantMembershipKey(userId),
    enabled: !!userId && !knownTenantId,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
    queryFn: async (): Promise<string | null> => {
      // Web parity: oldest membership wins (onboarding/page.tsx STORY-039).
      const { data, error } = await withTimeout(
        supabase
          .from("tenant_members")
          .select("tenant_id")
          .eq("user_id", userId as string)
          .order("joined_at", { ascending: true })
          .limit(1)
          .maybeSingle(),
      );
      if (error) throw new Error(error.message);
      const tenantId = data?.tenant_id ?? null;
      // Cache only the positive result: a stale «нет тенанта» must never
      // strand a user who got invited a minute later.
      if (tenantId) writeCache(tenantIdCacheKey(userId as string), tenantId);
      return tenantId;
    },
  });

  return {
    userId,
    tenantId: knownTenantId ?? membership.data ?? null,
    /** true → the id came from the MMKV cache, not the JWT: a CONFIRMED
     *  missing tenants row means the cache is dead and must be dropped. */
    tenantIdFromCache: !jwtTenantId && !!cachedTenantId,
    membership,
  };
}

/** Current tenant id. Synchronous shape for the ~40 query hooks that gate on
 *  it (`enabled: !!tenantId`): JWT/cache resolve instantly; the fresh-user
 *  fallback flips from null once the tenant_members lookup lands. */
export function useTenantId(): string | null {
  return useTenantResolution().tenantId;
}

// ---------------------------------------------------------------------------
// Onboarding gate.

export interface OnboardingTenant {
  id: string;
  name: string;
  vertical: string | null;
  onboarded_at: string | null;
}

export type OnboardingGate =
  | { status: "signed-out" }
  | { status: "loading" }
  | { status: "onboarded"; tenantId: string }
  | {
      status: "needs-onboarding";
      tenantId: string;
      tenant: OnboardingTenant;
    }
  // Confirmed: no membership row / tenant row gone. Terminal for this device
  // until retry — web maps this to /login?error=tenant_missing.
  | { status: "no-tenant" }
  // Transient lookup error (network / timeout / offline-paused) → fail-open.
  | { status: "unknown"; tenantId: string | null };

export const tenantOnboardingKey = (tenantId: string | null) =>
  ["tenant-onboarding", tenantId] as const;

export function useOnboardingGate(): OnboardingGate {
  const { userId, tenantId, tenantIdFromCache, membership } =
    useTenantResolution();
  // Once a tenant has been SEEN onboarded, the stamp short-circuits the gate
  // forever (onboarded_at never un-sets) — configured users pay zero network
  // and can never be bounced to onboarding by a flaky lookup.
  const stamped = tenantId
    ? readCache(onboardedStampKey(tenantId)) === "1"
    : false;

  const tenantQ = useQuery({
    queryKey: tenantOnboardingKey(tenantId),
    enabled: !!tenantId && !stamped,
    staleTime: 30_000,
    retry: 1,
    queryFn: async (): Promise<OnboardingTenant | null> => {
      const { data, error } = await withTimeout(
        supabase
          .from("tenants")
          .select("id, name, vertical, onboarded_at")
          .eq("id", tenantId as string)
          .maybeSingle(),
      );
      if (error) throw new Error(error.message);
      if (data?.onboarded_at) stampOnboarded(tenantId as string);
      // CONFIRMED dead CACHED tenant id (row gone / переехал в другой
      // тенант): drop the MMKV cache — the resulting re-render resolves
      // to knownTenantId=null, which re-enables the tenant_members lookup
      // instead of stranding the user on «no-tenant». JWT ids are not
      // ours to clear (web parity: login?error=tenant_missing).
      if (!data && tenantIdFromCache && userId) {
        removeCache(tenantIdCacheKey(userId));
      }
      return data ?? null;
    },
  });

  if (!userId) return { status: "signed-out" };

  if (tenantId) {
    if (stamped) return { status: "onboarded", tenantId };
    const row = tenantQ.data;
    if (row !== undefined) {
      if (row === null) return { status: "no-tenant" };
      return row.onboarded_at
        ? { status: "onboarded", tenantId }
        : { status: "needs-onboarding", tenantId, tenant: row };
    }
    if (tenantQ.isError || isPaused(tenantQ)) {
      return { status: "unknown", tenantId };
    }
    return { status: "loading" };
  }

  // No JWT/cached tenant — the membership lookup is the source of truth.
  if (membership.data === null) return { status: "no-tenant" };
  if (membership.isError || isPaused(membership)) {
    return { status: "unknown", tenantId: null };
  }
  return { status: "loading" };
}

/** Re-run failed gate lookups (the «Повторить» button on the onboarding
 *  screen's error states). */
export function useRetryOnboardingGate(): () => void {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["tenant-membership"] });
    void qc.invalidateQueries({ queryKey: ["tenant-onboarding"] });
  };
}

// ---------------------------------------------------------------------------
// Completion — mobile port of apps/web/src/app/onboarding/complete-action.ts.
// personal_calendar_enabled is intentionally NOT touched: the web wizard
// writes back the tenant's current value unchanged (the step was removed),
// so omitting the column produces the identical end state.

export interface CompleteOnboardingArgs {
  tenantId: string;
  name: string;
  vertical: string;
}

export function useCompleteOnboarding() {
  const qc = useQueryClient();
  return useMutation({
    // Онбординг-экран показывает ошибку сам (FormError) — без meta глобальный
    // MutationCache добавил бы второй, дублирующий Alert.
    meta: { errorHandled: true },
    mutationFn: async ({ tenantId, name, vertical }: CompleteOnboardingArgs) => {
      const { error, count } = await supabase
        .from("tenants")
        .update(
          {
            name: name.trim(),
            vertical,
            onboarded_at: new Date().toISOString(),
          },
          { count: "exact" },
        )
        .eq("id", tenantId);
      if (error) throw new Error(error.message);
      // RLS silently filters refused rows — 0 affected = permissions failure
      // (same guard as features/settings/tenant.ts useUpdateTenant).
      if (count === 0) {
        throw new Error(
          "Не удалось сохранить: завершить настройку может только владелец.",
        );
      }
    },
    onSuccess: (_data, { tenantId }) => {
      stampOnboarded(tenantId);
      // Всё tenant-состояние собиралось до онбординга (имя, vertical, гейт,
      // справочники) — инвалидируем целиком, кэш свежего тенанта пуст и дёшев.
      void qc.invalidateQueries();
    },
  });
}
