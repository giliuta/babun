import { createContext, useContext, useMemo, type ReactNode } from "react";
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
  const { tenantId, tenantName, kind, role, level, contacts, everyClient, isActive } = scope;
  const value = useMemo<ClientsScope>(
    () => ({ tenantId, tenantName, kind, role, level, contacts, everyClient, isActive }),
    [tenantId, tenantName, kind, role, level, contacts, everyClient, isActive],
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
            links: true,
            onlineOnly: false,
          },
    [scope],
  );
}
