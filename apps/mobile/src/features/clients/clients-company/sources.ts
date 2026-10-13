import { isUserRole, type UserRole } from "../../settings/role-policy";
import {
  ownScope,
  type ClientsScope,
  type CompanyAccess,
  type MembershipRow,
} from "./scope";

// Which sources the clients tab shows: own company first, then employers.

export type ClientsCompany =
  | { kind: "company"; scope: ClientsScope }
  | { kind: "none" }
  | { kind: "unknown" };

export interface ClientsCompanyInput {
  activeTenantId: string | null;
  /** `undefined` — роль ещё не пришла; `null` — роли в активной компании нет. */
  activeRole: UserRole | null | undefined;
  /** `undefined` — членства ещё не пришли. */
  memberships: readonly MembershipRow[] | undefined;
  names: ReadonlyMap<string, string>;
}

function joinedOrder(a: MembershipRow, b: MembershipRow): number {
  const at = Date.parse(a.joinedAt);
  const bt = Date.parse(b.joinedAt);
  if (!Number.isNaN(at) && !Number.isNaN(bt) && at !== bt) return at - bt;
  if (a.joinedAt !== b.joinedAt) return a.joinedAt < b.joinedAt ? -1 : 1;
  // Тот же добор, что у запасного пути `current_tenant_id()`.
  return a.tenantId < b.tenantId ? -1 : a.tenantId > b.tenantId ? 1 : 0;
}

/** СВОЯ компания вкладки: активная, если он её владелец, иначе самая ранняя
 *  из своих. Своей нет — `none`. */
export function clientsCompany(input: ClientsCompanyInput): ClientsCompany {
  const { activeTenantId, activeRole, memberships, names } = input;

  if (activeTenantId && activeRole === "owner") {
    return { kind: "company", scope: ownScope(activeTenantId, names, activeTenantId) };
  }
  // Роль ещё в пути, а членства уже знают: активная — своя.
  if (
    activeTenantId &&
    activeRole === undefined &&
    memberships?.some((m) => m.tenantId === activeTenantId && m.role === "owner")
  ) {
    return { kind: "company", scope: ownScope(activeTenantId, names, activeTenantId) };
  }
  if (!memberships) return { kind: "unknown" };

  // Строка членств бывает старее роли: если сервер уже сказал «мастер»,
  // активная компания не своя, что бы ни помнил список.
  const activeIsNotOwned = activeRole !== undefined && activeRole !== "owner";
  const owned = memberships
    .filter((m) => m.role === "owner")
    .filter((m) => !(activeIsNotOwned && m.tenantId === activeTenantId))
    .slice()
    .sort(joinedOrder);
  const first = owned[0];
  return first
    ? { kind: "company", scope: ownScope(first.tenantId, names, activeTenantId) }
    : { kind: "none" };
}

/** Источник-работодатель: компания, где человек работает, а её владелец
 *  открыл ему клиентов. Карта прав ещё не приехала (`undefined`) — источника
 *  пока нет, он появится сам. */
export function memberScope(
  tenantId: string,
  role: UserRole,
  access: CompanyAccess | undefined,
  names: ReadonlyMap<string, string>,
  activeTenantId: string | null,
): ClientsScope | null {
  if (!access || access.isOwner) return null;
  const level = access.clients;
  if (level !== "read" && level !== "write") return null;
  return {
    tenantId,
    tenantName: names.get(tenantId) ?? null,
    kind: "member",
    role,
    level,
    // «В день записи» — строка номера есть; открывается ли номер у этого
    // клиента, говорит сервер (`contacts_hidden`, дверь `member_client_contacts`).
    contacts: access.contacts === "read" || access.contacts === "day",
    everyClient: access.scope === "all",
    isActive: tenantId === activeTenantId,
    create: access.create === "write",
  };
}

export interface ClientsSourcesInput extends ClientsCompanyInput {
  /** Карты прав компаний, где человек НЕ владелец. */
  access: ReadonlyMap<string, CompanyAccess | undefined>;
}

export interface ClientsSources {
  /** Членства ещё не приехали — рисуем ожидание, а не «клиентов нет». */
  loading: boolean;
  /** Своя компания: её хозяйство и её футер. */
  primary: ClientsScope | null;
  /** Все источники списка: своя первой, дальше работодатели по вступлению. */
  list: ClientsScope[];
  /** Компании, чьи карты прав нужно спросить. */
  needAccess: string[];
}

/** Что показывает вкладка «Клиенты» целиком. */
export function clientsSources(input: ClientsSourcesInput): ClientsSources {
  const company = clientsCompany(input);
  const primary = company.kind === "company" ? company.scope : null;
  const memberships = input.memberships;
  if (!memberships) {
    return { loading: company.kind === "unknown", primary, list: primary ? [primary] : [], needAccess: [] };
  }
  const employers = memberships
    .filter((m) => m.role !== "owner" && m.tenantId !== primary?.tenantId)
    .slice()
    .sort(joinedOrder);
  const list: ClientsScope[] = primary ? [primary] : [];
  const needAccess: string[] = [];
  for (const membership of employers) {
    needAccess.push(membership.tenantId);
    const role = isUserRole(membership.role) ? membership.role : null;
    if (!role) continue;
    const scope = memberScope(
      membership.tenantId,
      role,
      input.access.get(membership.tenantId),
      input.names,
      input.activeTenantId,
    );
    if (scope) list.push(scope);
  }
  return { loading: false, primary, list, needAccess };
}

/** Вид доступа для ключей запросов источника: у своей компании — роль (ключ
 *  остаётся прежним, прогрев греет то же), у работодателя — его уровни. */
export function viewKeyOf(scope: ClientsScope): string {
  if (scope.kind !== "member") return scope.role;
  return [
    "member",
    scope.level,
    scope.everyClient ? "all" : "own",
    scope.contacts ? "phones" : "hidden",
  ].join(":");
}
