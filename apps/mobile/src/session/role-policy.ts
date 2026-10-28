import { tierAllows, tierOf, type TierFeature } from "@/session/tiers";
import { isMessagingReady } from "@/lib/messaging-readiness";

export const USER_ROLES = ["owner", "dispatcher", "master"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export type AppCapability =
  | "view-cabinet"
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

const ROLE_CAPABILITIES: Record<UserRole, ReadonlySet<AppCapability>> = {
  owner: new Set<AppCapability>([
    "view-cabinet",
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
    "operate-calendar",
    "create-appointment",
    "operate-clients",
    "manage-client-settings",
    "manage-messaging",
    "manage-personal-account",
  ]),
  master: new Set<AppCapability>([
    "view-cabinet",
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

// ЛИЧНЫЕ СТРАНИЦЫ КАБИНЕТА ОТКРЫТЫ ЛЮБОЙ РОЛИ («Кабинет — личное»):
// приглашения приходят человеку, а не компании, и профиль — его имя и
// телефон. Данных компании там нет, поэтому и закрывать их нечем. Так же
// личные «Уведомления» и «О приложении» (это телефон человека). «Помощь» —
// частые вопросы и связь с поддержкой: строка стоит в блоке «Аккаунт» у любой
// роли, и партнёр, нажав её, упирался в «Недостаточно прав». «Языки» — язык
// этого телефона.
const PERSONAL_CABINET_ROUTES = [
  "/cabinet/invitations",
  "/cabinet/profile",
  "/cabinet/notifications",
  "/cabinet/languages",
  "/cabinet/about",
  "/cabinet/help",
] as const;

// «Сводка» открыта всем ролям: значок аналитики открывается у каждого, а данных может не быть.
// Экран считает по тому, что человек и так вправе прочитать: свои записи, свои
// клиенты, свои деньги. Без доступа он показывает нули, а не отказ.
const INSIGHTS_ROUTE = "/cabinet/insights";

// «Реквизиты» (из шестерёнки «Финансов» в Кабинет): дверь открыта
// любой роли, страницу закрывает право строки «Реквизиты»
// (`FinanceSettingsRoute`), а данные — политика `legal_entities`.
const REQUISITES_ROUTE = "/cabinet/requisites";

/** Страницы партнёров — по праву «Партнёры» (директор). */
const PEOPLE_ROUTE = "/cabinet/people";

/** Страницы Кабинета за аккаунт (`?tenant=`, блок аккаунта). История
 *  изменений — по праву «История изменений» того же раздела «Кабинет». */
const ACCOUNT_CABINET_ROUTES = ["/cabinet/tariff", "/cabinet/payments", "/cabinet/sms", "/cabinet/history"] as const;

const DISPATCHER_CABINET_ROUTES = new Set([
  "/cabinet",
  // Тариф, оплаты и SMS аккаунта, который пригласил: страница
  // сама решает по праву «Тариф» / «Оплаты тарифа» / «SMS».
  ...ACCOUNT_CABINET_ROUTES,
  INSIGHTS_ROUTE,
  "/cabinet/account",
  "/cabinet/inventory",
  "/cabinet/sync",
  REQUISITES_ROUTE,
  ...PERSONAL_CABINET_ROUTES,
]);

const MASTER_CABINET_ROUTES = new Set([
  "/cabinet",
  // Тариф, оплаты и SMS аккаунта, который пригласил: страница
  // сама решает по праву «Тариф» / «Оплаты тарифа» / «SMS».
  ...ACCOUNT_CABINET_ROUTES,
  INSIGHTS_ROUTE,
  "/cabinet/account",
  "/cabinet/inventory",
  REQUISITES_ROUTE,
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
  /** Право «Партнёры» видно (директор): страницы партнёров открыты. */
  partners = false,
): boolean {
  const path = normalizePath(pathname);
  if (!path.startsWith("/cabinet")) return true;
  if (role === "owner") return true;
  if (partners && (role === "master" || role === "dispatcher") && (path === PEOPLE_ROUTE || path.startsWith(`${PEOPLE_ROUTE}/`))) {
    return true;
  }
  if (role === "dispatcher") return DISPATCHER_CABINET_ROUTES.has(path);
  if (role === "master") return MASTER_CABINET_ROUTES.has(path);
  return false;
}

/**
 * РОЛЬ, КОТОРОЙ СУДИТСЯ ЭКРАН КАБИНЕТА (STORY-082).
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

// ДОРОГУ ВО ВКЛАДКУ «КЛИЕНТЫ» БОЛЬШЕ НЕ РЕШАЕТ РОЛЬ (STORY-082).
// Здесь жил `canAccessClientPath`: мастеру был открыт ровно один адрес —
// карточка клиента его записи, — а список и настройки закрывала граница
// роли. Теперь вкладка открывается всем, а что показать и что можно, решает
// ИСТОЧНИК (`session/clients-company.ts`): своя компания, компания,
// где человеку открыли клиентов уровнями, или клиент записи.

// ─────────────────────────────────────────────────────────────────────
// ТАРИФ — ВТОРАЯ ПОЛОВИНА ДВЕРИ.
//
// Роль отвечает на вопрос «кто ты в этой компании», тариф — «за что заплачено».
// Это РАЗНЫЕ вопросы, и путать их нельзя: владелец бесплатного контура имеет
// все права владельца и всё равно не записывает клиентов.
//
// Новому человеку — личный календарь и личные финансы; писать туда клиентские
// записи он не может, пока не купит план — тогда уже тариф. Отсюда граница:
// бесплатно живут события, финансы целиком и
// база контактов; закрыты работа с клиентами, услуги, мастера и документы.
//
// ИСТИНА НА СЕРВЕРЕ, А НЕ ЗДЕСЬ. Те же четыре ограничения стоят триггером
// `enforce_plan_limits` (миграция free_plan_limits): экран обязан не показывать
// то, чего нельзя, но проверка живёт в базе — иначе любой другой путь (deep
// link, старая сборка, офлайн-очередь) обходит замок. Канон, правило 10.

/** Возможность, которую открывает тариф («Соло · Про · Макс»,
 *  `session/tiers.ts`). */
export type PlanCapability = TierFeature;

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
  return tierAllows(tierOf({ plan }), capability);
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
