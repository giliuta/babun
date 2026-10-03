import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { parseMemberAccessMap, type MemberAccessMap } from "@/features/access/access-map";
import { accessGate, type AccessGate } from "@/features/access/my-access";
import { useMyAccess } from "@/features/access/queries";
import { fetchTenantProfile } from "@/features/settings/company-fetchers";
import { useMyMemberships } from "@/features/settings/my-memberships";
import type { UserRole } from "@/features/settings/role-policy";
import { useDataRole, useTenant } from "@/features/settings/tenant";
import { myAccessQueryKey, tenantQueryKey } from "@/lib/company-query-keys";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { tenantBoundClient } from "@/lib/tenant-bound-client";

import { roleInAccount } from "./account-role";

// АККАУНТ СТРАНИЦЫ КАБИНЕТА (владелец 04.10: «если мы даём доступ к нашим
// командам, то можем дать доступ и к кабинету — реквизиты, тариф, SMS,
// оплата… но это должно быть зафиксировано за нашей командой, чтобы человек
// случайно не перепутал и не оплатил что-то своё»).
//
// Аккаунт на телефоне «открыт» один — тот, чей календарь выбран последним, —
// и у партнёра это то свой аккаунт, то пригласивший. Страницы тарифа, оплат,
// SMS и реквизитов поэтому НЕ берут его молча: блок аккаунта в Кабинете
// называет аккаунт явно (`?tenant=` → `AccountScopeProvider`), и чтение, права
// и оплата идут за него. Без явного аккаунта всё как раньше — открытый на
// телефоне.

const ScopeContext = createContext<string | null>(null);

/** Страницы внутри работают за аккаунт `tenantId`. */
export function AccountScopeProvider({ tenantId, children }: { tenantId: string | null; children: ReactNode }) {
  return <ScopeContext.Provider value={tenantId}>{children}</ScopeContext.Provider>;
}

export interface AccountScope {
  tenantId: string | null;
  /** Аккаунт страницы — не тот, что открыт на телефоне. */
  foreign: boolean;
  /** Клиент под заголовком этого аккаунта (`x-babun-tenant`). */
  client: typeof supabase;
  /** Роль человека в этом аккаунте; `null` — его там нет. */
  role: UserRole | null | undefined;
}

export function useAccountScope(): AccountScope {
  const explicit = useContext(ScopeContext);
  const activeTenantId = useTenantId();
  const activeRole = useDataRole().data;
  const memberships = useMyMemberships().data;
  const foreign = !!explicit && explicit !== activeTenantId;
  const tenantId = foreign ? explicit : activeTenantId;
  const client = useMemo(
    () => (foreign && explicit ? tenantBoundClient(explicit) : supabase),
    [foreign, explicit],
  );
  const role = foreign && explicit ? roleInAccount(memberships, explicit) : activeRole;
  return { tenantId, foreign, client, role };
}

/** Профиль аккаунта страницы (`current_tenant_profile_safe`): имя, тариф;
 *  партнёру с «Тариф: Видит» — и сроки подписки. */
export function useAccountProfile() {
  const scope = useAccountScope();
  const active = useTenant();
  const foreign = useQuery({
    // Свой хвост ключа: профиль открытого аккаунта (`useTenant`) ещё и ставит
    // валюту сумм, а этот — нет; общий кэш смешал бы два чтения.
    queryKey: [...tenantQueryKey(scope.tenantId, scope.role), "cabinet"],
    enabled: scope.foreign && !!scope.tenantId && !!scope.role,
    queryFn: () => fetchTenantProfile(scope.client, scope.tenantId as string, scope.role as UserRole),
  });
  return scope.foreign ? foreign : active;
}

/** Свои права в аккаунте страницы. */
export function useAccountAccess(): MemberAccessMap | undefined {
  const scope = useAccountScope();
  const active = useMyAccess().data;
  const foreign = useQuery({
    queryKey: myAccessQueryKey(scope.tenantId),
    enabled: scope.foreign && !!scope.tenantId,
    networkMode: "always",
    queryFn: async (): Promise<MemberAccessMap> => {
      const { data, error } = await scope.client.rpc("my_access_map");
      if (error) throw new Error(error.message);
      return parseMemberAccessMap(data);
    },
  });
  return scope.foreign ? foreign.data : active;
}

/** Положение права аккаунта (`cabinet.*`, «Реквизиты») в аккаунте страницы:
 *  владельцу — «write», партнёру — по своей строке. */
export function useAccountGate(blockKey: string): AccessGate {
  const scope = useAccountScope();
  const map = useAccountAccess();
  return accessGate({ role: scope.role, map, blockKey, scope: "company" });
}

/** Имя аккаунта страницы — для шапки и кнопки оплаты («Оплатить за Giliuta»). */
export function useAccountName(): string | null {
  const profile = useAccountProfile().data as { name?: string | null } | null | undefined;
  const name = profile?.name?.trim();
  return name ? name : null;
}
