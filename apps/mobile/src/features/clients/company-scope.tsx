import { createContext, useContext, useMemo, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { tenantBoundClient } from "@/lib/tenant-bound-client";
import { useDataRole } from "@/features/settings/tenant";
import type { UserRole } from "@/features/settings/role-policy";
import {
  capabilitiesOf,
  type ClientsCapabilities,
  type ClientsScope,
} from "./clients-company";

// КОМПАНИЯ ЭКРАНА КЛИЕНТОВ — ОДНА НА ПОДДЕРЕВО.
//
// Вкладка «Клиенты» больше не живёт в одной компании: список склеен из своей
// компании и компаний-работодателей, а карточка открывается в компании своей
// строки (`?tenant=`). Чтобы каждый блок карточки не выяснял это заново,
// экран объявляет источник контекстом, а хуки клиентов читают его.
//
// БЕЗ ПРОВАЙДЕРА ВСЁ РАБОТАЕТ КАК РАНЬШЕ: форма записи, пикеры и «Финансы
// дня» зовут те же хуки вне вкладки — там источник не объявлен, и хуки берут
// активную компанию устройства. Это осознанный запасной путь, а не забытый
// случай: запись всегда делается в календаре, который открыт.

const ClientsScopeContext = createContext<ClientsScope | null>(null);

export function ClientsScopeProvider({
  scope,
  children,
}: {
  scope: ClientsScope;
  children: ReactNode;
}) {
  // Значение меняется только вместе с самим источником: иначе каждое
  // перерисовывание вкладки роняло бы кэш карточки. Поля разобраны по одному
  // намеренно — объект источника собирается заново на каждый рендер ворот.
  const { tenantId, tenantName, kind, role, level, contacts, everyClient, isActive, create } = scope;
  const value = useMemo<ClientsScope>(
    () => ({ tenantId, tenantName, kind, role, level, contacts, everyClient, isActive, create }),
    [tenantId, tenantName, kind, role, level, contacts, everyClient, isActive, create],
  );
  return <ClientsScopeContext.Provider value={value}>{children}</ClientsScopeContext.Provider>;
}

/** Источник экрана или `null` — значит экран вне вкладки (запись, пикеры). */
export function useClientsScopeOrNull(): ClientsScope | null {
  return useContext(ClientsScopeContext);
}

/** Что можно в источнике этого экрана. Вне вкладки — как у своей активной
 *  компании: там всё решает роль, как и до общей страницы. */
export function useClientsCapabilities(): ClientsCapabilities {
  const scope = useClientsScopeOrNull();
  return useMemo(
    () =>
      scope
        ? capabilitiesOf(scope)
        : {
            manage: true,
            create: true,
            edit: true,
            contacts: true,
            money: true,
            book: true,
            files: true,
            export: true,
            links: true,
            onlineOnly: false,
          },
    [scope],
  );
}

/** КОМПАНИЯ, В КОТОРОЙ ЭКРАН ВКЛАДКИ ЧИТАЕТ И ПИШЕТ (01.10). Источник экрана,
 *  а вне вкладки — компания, открытая в календаре. Партнёр со своей компанией
 *  правит настройки команд работодателя, не переключая календарь, а владелец
 *  — свои, пока в календаре открыта чужая: запросы идут клиентом,
 *  привязанным к этой компании (`bind-tenant`), а не активным. */
export function useScopeCompany(): {
  tenantId: string | null;
  client: typeof supabase;
  /** Роль человека в этой компании; `undefined` — ещё едет. */
  role: UserRole | null | undefined;
  /** Компания не открыта в календаре: кэш её на диск не ложится. */
  foreign: boolean;
} {
  const scope = useClientsScopeOrNull();
  const activeTenantId = useTenantId();
  const activeRole = useDataRole().data;
  if (scope && scope.tenantId !== activeTenantId) {
    return {
      tenantId: scope.tenantId,
      client: tenantBoundClient(scope.tenantId),
      role: scope.role,
      foreign: true,
    };
  }
  return { tenantId: activeTenantId, client: supabase, role: activeRole, foreign: false };
}
