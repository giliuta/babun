import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { tenantBoundClient } from "@/lib/tenant-bound-client";
import { useTenantId } from "@/lib/tenant";
import { myAccessQueryKey } from "@/lib/company-query-keys";
import { parseMemberAccessMap, type MemberAccessMap } from "@/features/access/access-map";
import { useMyAccess } from "@/features/access/queries";
import { useMirror } from "@/features/access/mirror/mirror-state";
import { useMyMemberships } from "@/features/settings/my-memberships";
import { useMyCalendars } from "@/features/settings/workspaces";
import { useCurrentRole } from "@/features/settings/tenant";
import {
  clientsSources,
  type ClientsSources,
  type CompanyAccess,
} from "./clients-company";

// ИСТОЧНИКИ ВКЛАДКИ «КЛИЕНТЫ» — ЖИВОЙ СЛОЙ НАД ЧИСТЫМ ПРАВИЛОМ.
//
// Правило (`clients-company.ts`) отвечает, что показывать; этот хук приносит
// ему три факта: свои членства с датой вступления, имена компаний и КАРТУ
// ПРАВ каждой компании, где человек не владелец.
//
// Карта активной компании уже живёт в приложении (`useMyAccess`) — её берём
// оттуда, а не спрашиваем второй раз: ключ у неё тот же, и сигнал
// `access_changed` обновляет именно его. Карты остальных компаний читаются
// клиентом, привязанным к компании (`bind-tenant`): заголовок называет
// компанию, а ответ по-прежнему даёт членство на сервере.

/** Права клиентов одной компании — из карты прав. */
function accessOf(map: MemberAccessMap | undefined): CompanyAccess | undefined {
  if (!map) return undefined;
  return {
    isOwner: map.isOwner,
    clients: map.company["clients"],
    scope: map.company["clients.scope"],
    contacts: map.company["clients.contacts"],
  };
}

/** Карты прав чужих компаний. Активную сюда не передаём: она уже читается
 *  приложением, и второй читатель под тем же ключом лишний. */
function useAccessMaps(tenantIds: readonly string[]): Map<string, MemberAccessMap | undefined> {
  const results = useQueries({
    queries: tenantIds.map((tenantId) => ({
      queryKey: myAccessQueryKey(tenantId),
      networkMode: "always" as const,
      staleTime: 60_000,
      queryFn: async (): Promise<MemberAccessMap> => {
        const { data, error } = await tenantBoundClient(tenantId).rpc("my_access_map");
        if (error) throw new Error(`my_access_map: ${error.message}`);
        return parseMemberAccessMap(data);
      },
    })),
  });
  // Ответы приходят по одному, а карта нужна целиком: пересобираем её, когда
  // у любого запроса обновилось время ответа.
  const stamps = results.map((result) => result.dataUpdatedAt).join(",");
  const ids = tenantIds.join(",");
  return useMemo(() => {
    const map = new Map<string, MemberAccessMap | undefined>();
    tenantIds.forEach((tenantId, index) => map.set(tenantId, results[index]?.data));
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- сборка идёт по времени ответов, а не по массиву результатов
  }, [ids, stamps]);
}

/** Что показывает вкладка «Клиенты»: своя компания и компании, где человеку
 *  открыли клиентов. */
export function useClientsSources(): ClientsSources {
  const activeTenantId = useTenantId();
  const activeRole = useCurrentRole().data;
  // В ЗЕРКАЛЕ ЧЕЛОВЕК — НЕ ВЛАДЕЛЕЦ ЭТОЙ КОМПАНИИ (STORY-083). Иначе вкладка
  // считала бы компанию «своей» (владелец ведь смотрит своими глазами), и
  // уровни «Клиенты», «Какие клиенты», «Телефоны» в предпросмотре не
  // действовали бы вовсе: телефоны оставались бы на месте при «Скрыт».
  const mirror = useMirror();
  const memberships = useMyMemberships().data;
  const calendars = useMyCalendars().data;
  const activeAccess = useMyAccess().data;

  const names = useMemo(() => {
    const byTenant = new Map<string, string>();
    for (const calendar of calendars ?? []) byTenant.set(calendar.tenantId, calendar.tenantName);
    return byTenant;
  }, [calendars]);

  // Первый проход — только активная компания: он же называет, чьи карты нужны.
  const withActive = useMemo(() => {
    const access = new Map<string, CompanyAccess | undefined>();
    if (activeTenantId) access.set(activeTenantId, accessOf(activeAccess));
    if (mirror && activeTenantId) {
      // Членство одно — эта компания, и человек в ней сотрудник: источник
      // собирается теми же правилами, что у настоящего работодателя.
      return clientsSources({
        activeTenantId,
        activeRole: mirror.role,
        memberships: [{ tenantId: activeTenantId, role: mirror.role, joinedAt: "" }],
        names,
        access,
      });
    }
    return clientsSources({ activeTenantId, activeRole, memberships, names, access });
  }, [activeTenantId, activeRole, memberships, names, activeAccess, mirror]);

  // Список компаний держим строкой: массив, собранный заново на каждый
  // рендер, пересоздавал бы запросы и карту без единой смены данных.
  const foreignKey = withActive.needAccess
    .filter((tenantId) => tenantId !== activeTenantId)
    .sort()
    .join(",");
  const foreign = useMemo(() => (foreignKey ? foreignKey.split(",") : []), [foreignKey]);
  const foreignMaps = useAccessMaps(foreign);

  return useMemo(() => {
    // В ЗЕРКАЛЕ ИСТОЧНИК СОБРАН ВЫШЕ И ПЕРЕСБОРКЕ НЕ ПОДЛЕЖИТ. Второй проход
    // считает по НАСТОЯЩИМ роли и членствам — то есть по владельцу, — и
    // вкладка посреди просмотра вернулась бы к его глазам. Сегодня спасает
    // только то, что у зеркала одно членство и чужих компаний не бывает.
    if (mirror) return withActive;
    if (foreign.length === 0) return withActive;
    const access = new Map<string, CompanyAccess | undefined>();
    if (activeTenantId) access.set(activeTenantId, accessOf(activeAccess));
    for (const [tenantId, map] of foreignMaps) access.set(tenantId, accessOf(map));
    return clientsSources({ activeTenantId, activeRole, memberships, names, access });
  }, [withActive, mirror, foreign.length, foreignMaps, activeTenantId, activeRole, memberships, names, activeAccess]);
}

/** Клиент Supabase для источника: своя активная компания ходит обычным,
 *  остальные — привязанным к своей компании. */
export function clientFor(tenantId: string, isActive: boolean) {
  return isActive ? supabase : tenantBoundClient(tenantId);
}
