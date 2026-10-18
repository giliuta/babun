import { can, type UserRole } from "../role-policy";
import { ownScope, type ClientsScope } from "./scope";
import type { ClientsSources } from "./sources";

// Route gate of the clients screens and the scope outside the tab.

export type RouteKind = "tab" | "card" | "card-sub";

export type RouteDecision =
  | { state: "wait" }
  | { state: "words"; reason: "no-company" | "not-found" | "not-allowed" }
  | { state: "open"; scope: ClientsScope };

export interface RouteInput {
  kind: RouteKind;
  /** `?tenant=` ссылки; пусто — компания по умолчанию для вида экрана. */
  tenantParam?: string | null;
  activeTenantId: string | null;
  activeRole: UserRole | null | undefined;
  activeName: string | null;
  sources: ClientsSources;
  /** Вход из записи и календаря: карточка всегда в компании календаря. */
  forceActive?: boolean;
}

/** Карточка клиента ЗАПИСИ — старая дорога мастера: базы у него нет, но
 *  клиента своей заявки он открывает (безопасная функция сервера). */
function recordScope(tenantId: string, role: UserRole, name: string | null): ClientsScope {
  return {
    tenantId,
    tenantName: name,
    kind: "record",
    role,
    level: "read",
    contacts: true,
    everyClient: false,
    isActive: true,
  };
}

/** Что показать экрану клиентов. Вкладка — общая страница источников; карточка
 *  без `?tenant=` — компания календаря (так в неё приходят из записи). */
export function clientsRouteDecision(input: RouteInput): RouteDecision {
  const { kind, activeTenantId, activeRole, activeName, sources } = input;
  const tenantParam = input.tenantParam || null;

  if (kind === "tab") {
    if (sources.loading) return { state: "wait" };
    if (sources.list.length === 0) return { state: "words", reason: "no-company" };
    const primary = sources.primary ?? sources.list[0]!;
    if (tenantParam && tenantParam !== primary.tenantId) {
      const other = sources.list.find((scope) => scope.tenantId === tenantParam);
      return other ? { state: "open", scope: other } : { state: "words", reason: "not-found" };
    }
    return { state: "open", scope: primary };
  }

  const wantsActive = input.forceActive || !tenantParam || tenantParam === activeTenantId;
  if (wantsActive) {
    if (!activeTenantId || activeRole === undefined) return { state: "wait" };
    if (activeRole === null) return { state: "words", reason: "not-found" };
    const known = sources.list.find((scope) => scope.tenantId === activeTenantId);
    if (known) {
      // Визиты и вложения чужой компании сотруднику не открываем: это её
      // история и её файлы, а не карточка клиента. Записи он видит в календаре.
      if (kind === "card-sub" && known.kind !== "own") {
        return { state: "words", reason: "not-allowed" };
      }
      return { state: "open", scope: known };
    }
    if (can(activeRole, "operate-clients")) {
      return {
        state: "open",
        scope: {
          ...ownScope(activeTenantId, new Map(), activeTenantId),
          tenantName: activeName,
          role: activeRole,
        },
      };
    }
    // Мастер без базы открывает саму карточку клиента записи; её визиты и
    // вложения — нет.
    return kind === "card"
      ? { state: "open", scope: recordScope(activeTenantId, activeRole, activeName) }
      : { state: "words", reason: "not-allowed" };
  }

  if (sources.loading) return { state: "wait" };
  const source = sources.list.find((scope) => scope.tenantId === tenantParam);
  if (!source) return { state: "words", reason: "not-found" };
  if (kind === "card-sub" && source.kind !== "own") {
    return { state: "words", reason: "not-allowed" };
  }
  return { state: "open", scope: source };
}

/** ИСТОЧНИК ВНЕ ВКЛАДКИ — КОМПАНИЯ УСТРОЙСТВА И РОЛЬ В НЕЙ.
 *
 *  Карточку клиента зовут не только из вкладки: из записи, из шторки долга, из
 *  пикеров. Там провайдера источника нет, и хуки берут активную компанию —
 *  ровно как до общей страницы. Правилам, которым мало `QueryScope` (связи
 *  спрашивают `caps.links`, а он считается из уровней), нужен тот же ответ
 *  ЦЕЛЫМ источником, и собирается он здесь — одной веткой с `card` выше, а не
 *  вторым её списком. */
export function activeCompanyScope(
  tenantId: string,
  role: UserRole,
  name: string | null,
): ClientsScope {
  return can(role, "operate-clients")
    ? { ...ownScope(tenantId, new Map(), tenantId), tenantName: name, role }
    : recordScope(tenantId, role, name);
}
