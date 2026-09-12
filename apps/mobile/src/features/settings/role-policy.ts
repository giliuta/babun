import { isMessagingReady } from "@/features/chats/readiness";

export const USER_ROLES = ["owner", "dispatcher", "master"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export type AppCapability =
  | "view-cabinet"
  | "view-company-profile"
  | "manage-company"
  | "manage-workforce"
  | "manage-calendar-settings"
  | "create-appointment"
  | "operate-calendar"
  | "operate-clients"
  | "manage-client-settings"
  | "manage-messaging"
  | "view-finances"
  | "close-day"
  | "view-insights"
  | "manage-personal-account";

// A role grant is necessary but not sufficient for messaging. The unified
// inbox stays closed until every server/provider prerequisite is ready.
export const MESSAGING_ENABLED = isMessagingReady();

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: "Владелец",
  dispatcher: "Диспетчер",
  master: "Бригадир / мастер",
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  owner: "Полный доступ к компании, сотрудникам и финансам.",
  dispatcher: "Клиенты, записи и рабочая коммуникация без финансов и опасных настроек.",
  master: "Рабочий график и разрешённые действия внутри назначенных заявок.",
};

const ROLE_CAPABILITIES: Record<UserRole, ReadonlySet<AppCapability>> = {
  owner: new Set<AppCapability>([
    "view-cabinet",
    "view-company-profile",
    "manage-company",
    "manage-workforce",
    "manage-calendar-settings",
    "create-appointment",
    "operate-calendar",
    "operate-clients",
    "manage-client-settings",
    "manage-messaging",
    "view-finances",
    "close-day",
    "view-insights",
    "manage-personal-account",
  ]),
  dispatcher: new Set<AppCapability>([
    "view-cabinet",
    "view-company-profile",
    "operate-calendar",
    "create-appointment",
    "operate-clients",
    "manage-client-settings",
    "manage-messaging",
    "manage-personal-account",
  ]),
  master: new Set<AppCapability>([
    "view-cabinet",
    "view-company-profile",
    "operate-calendar",
    "manage-personal-account",
  ]),
};

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && USER_ROLES.includes(value as UserRole);
}

export function can(
  role: UserRole | null | undefined,
  capability: AppCapability,
): boolean {
  if (capability === "manage-messaging" && !MESSAGING_ENABLED) return false;
  return role ? ROLE_CAPABILITIES[role].has(capability) : false;
}

const DISPATCHER_CABINET_ROUTES = new Set([
  "/cabinet",
  "/cabinet/account",
  "/cabinet/business",
  "/cabinet/inventory",
  "/cabinet/recurring",
  "/cabinet/sms-templates",
  "/cabinet/sync",
  "/cabinet/unclosed",
]);

const MASTER_CABINET_ROUTES = new Set([
  "/cabinet",
  "/cabinet/account",
  "/cabinet/business",
  "/cabinet/inventory",
]);

function normalizePath(pathname: string): string {
  const withoutQuery = pathname.split("?", 1)[0] ?? pathname;
  if (withoutQuery.length > 1 && withoutQuery.endsWith("/")) {
    return withoutQuery.slice(0, -1);
  }
  return withoutQuery;
}

/**
 * Cabinet deep-link policy. The owner can use every company setting;
 * dispatcher/master routes are an explicit allow-list so a newly added
 * sensitive screen is closed until its role semantics are decided.
 */
export function canAccessCabinetPath(
  role: UserRole | null | undefined,
  pathname: string,
): boolean {
  const path = normalizePath(pathname);
  if (!path.startsWith("/cabinet")) return true;
  if (role === "owner") return true;
  if (role === "dispatcher") return DISPATCHER_CABINET_ROUTES.has(path);
  if (role === "master") return MASTER_CABINET_ROUTES.has(path);
  return false;
}

const UUID_PATH_SEGMENT =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const ASSIGNED_CLIENT_DETAIL_PATH = new RegExp(
  `^/clients/${UUID_PATH_SEGMENT}$`,
);

/** Masters may open only a concrete assigned-client card. The list, create
 * flow and client settings remain closed; the card query itself is an
 * assignment-scoped safe RPC, so a guessed UUID resolves to no data. */
export function canAccessClientPath(
  role: UserRole | null | undefined,
  pathname: string,
): boolean {
  const path = normalizePath(pathname);
  if (role === "owner" || role === "dispatcher") return true;
  return role === "master" && ASSIGNED_CLIENT_DETAIL_PATH.test(path);
}

// ─────────────────────────────────────────────────────────────────────
// ТАРИФ — ВТОРАЯ ПОЛОВИНА ДВЕРИ.
//
// Роль отвечает на вопрос «кто ты в этой компании», тариф — «за что заплачено».
// Это РАЗНЫЕ вопросы, и путать их нельзя: владелец бесплатного контура имеет
// все права владельца и всё равно не записывает клиентов.
//
// Владелец 2026-09-12: «самое главное — новому человеку личный календарь и
// личные финансы; писать туда клиентские записи он не может, а покупает план —
// тогда уже тариф». Отсюда граница: бесплатно живут события, финансы целиком и
// база контактов; закрыты работа с клиентами, услуги, мастера и документы.
//
// ИСТИНА НА СЕРВЕРЕ, А НЕ ЗДЕСЬ. Те же четыре ограничения стоят триггером
// `enforce_plan_limits` (миграция free_plan_limits): экран обязан не показывать
// то, чего нельзя, но проверка живёт в базе — иначе любой другой путь (deep
// link, старая сборка, офлайн-очередь) обходит замок. Канон, правило 10.

export type PlanCapability =
  | "book-clients"
  | "services"
  | "masters"
  | "documents";

/** Что бесплатный уровень НЕ умеет. Перечислено закрытое, а не открытое:
 *  новая функция продукта по умолчанию бесплатна, и закрывать её — отдельное
 *  осознанное решение, а не следствие забытой строки в списке. */
const FREE_PLAN_CLOSED: ReadonlySet<PlanCapability> = new Set<PlanCapability>([
  "book-clients",
  "services",
  "masters",
  "documents",
]);

/** Действующий тариф: ручная выдача (`plan_override`) всегда сильнее
 *  оплаченного. Повторяет `public.tenant_effective_plan` — если правило
 *  меняется, оно меняется в обоих местах одним заходом. */
export function effectivePlan(
  tenant: { plan?: string | null; plan_override?: string | null } | null | undefined,
): string | null {
  if (!tenant) return null;
  const override = tenant.plan_override?.trim();
  if (override) return override;
  const plan = tenant.plan?.trim();
  return plan ? plan : null;
}

/** Разрешает ли ТАРИФ это действие.
 *
 *  Неизвестный тариф считается платным. Так задумано: ошибка в данных или
 *  новое название тарифа не имеют права запереть работающему человеку
 *  продукт — запирает только явный `free`. Пока тариф не загружен (`null`),
 *  экран тоже не режет: мигание «нельзя → можно» на холодном старте выглядит
 *  как сломанный продукт. */
export function planAllows(
  plan: string | null | undefined,
  capability: PlanCapability,
): boolean {
  if (plan !== "free") return true;
  return !FREE_PLAN_CLOSED.has(capability);
}

/** Единственная дверь: действие разрешено, только если его пускают И роль,
 *  И тариф. Вызывающему не нужно помнить, какая половина за что отвечает. */
export function allow(
  ctx: {
    role: UserRole | null | undefined;
    plan: string | null | undefined;
  },
  capability: AppCapability,
  planCapability?: PlanCapability,
): boolean {
  if (!can(ctx.role, capability)) return false;
  return planCapability ? planAllows(ctx.plan, planCapability) : true;
}
