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

// ЛИЧНЫЕ СТРАНИЦЫ КАБИНЕТА ОТКРЫТЫ ЛЮБОЙ РОЛИ (15.09, «Кабинет — личное»):
// приглашения приходят человеку, а не компании, и профиль — его имя и
// телефон. Данных компании там нет, поэтому и закрывать их нечем. Так же
// личные «Уведомления» и «О приложении» (это телефон человека) и «Компания»
// (`?tenant=` — его собственное членство: роль и календари; тариф страница
// показывает только владельцу).
const PERSONAL_CABINET_ROUTES = [
  "/cabinet/invitations",
  "/cabinet/profile",
  "/cabinet/notifications",
  "/cabinet/about",
  "/cabinet/company",
] as const;

// «Сводка» открыта всем ролям (владелец 20.09: «справа значок аналитики — он
// есть; если на него тапнуть, открывается, ну значит не будет данных там»).
// Экран считает по тому, что человек и так вправе прочитать: свои записи, свои
// клиенты, свои деньги. Без доступа он показывает нули, а не отказ.
const INSIGHTS_ROUTE = "/cabinet/insights";

const DISPATCHER_CABINET_ROUTES = new Set([
  "/cabinet",
  INSIGHTS_ROUTE,
  "/cabinet/account",
  "/cabinet/business",
  "/cabinet/inventory",
  "/cabinet/recurring",
  "/cabinet/sync",
  ...PERSONAL_CABINET_ROUTES,
]);

const MASTER_CABINET_ROUTES = new Set([
  "/cabinet",
  INSIGHTS_ROUTE,
  "/cabinet/account",
  "/cabinet/business",
  "/cabinet/inventory",
  ...PERSONAL_CABINET_ROUTES,
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

/**
 * РОЛЬ, КОТОРОЙ СУДИТСЯ ЭКРАН КАБИНЕТА (STORY-082, владелец 20.09).
 *
 * Аналитику клиентов открывают из вкладки «Клиенты», а та в чужой команде
 * показывает СВОЮ компанию и передаёт её в `?tenant=`. Судить такой экран
 * ролью в компании, открытой в календаре, неверно: владелец своей компании
 * упирался бы в «Недостаточно прав» только потому, что в календаре стоит
 * чужая.
 *
 * Компания из ссылки не верится на слово: роль в ней берётся из СВОИХ
 * членств (`tenant_members`). Чужой или выдуманный идентификатор не находит
 * строки — и всё решает прежняя, активная роль. Данные экрана всё равно
 * закрыты правилами базы; здесь — только дверь.
 */
export function cabinetScreenRole(
  activeRole: UserRole | null | undefined,
  screenTenantId: string | null,
  memberships: readonly { tenantId: string; role: string }[] | undefined,
): UserRole | null | undefined {
  if (!screenTenantId) return activeRole;
  const row = memberships?.find((m) => m.tenantId === screenTenantId);
  if (!row || !isUserRole(row.role)) return activeRole;
  return row.role;
}

// ДОРОГУ ВО ВКЛАДКУ «КЛИЕНТЫ» БОЛЬШЕ НЕ РЕШАЕТ РОЛЬ (STORY-082, 19.09).
// Здесь жил `canAccessClientPath`: мастеру был открыт ровно один адрес —
// карточка клиента его записи, — а список и настройки закрывала граница
// роли. Теперь вкладка открывается всем, а что показать и что можно, решает
// ИСТОЧНИК (`features/clients/clients-company.ts`): своя компания, компания,
// где человеку открыли клиентов уровнями, или клиент записи.

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
