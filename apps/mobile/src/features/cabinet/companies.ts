// «МОИ КОМПАНИИ» В КАБИНЕТЕ — ЧИСТЫЕ ПРАВИЛА.
//
// Владелец 2026-09-15: Кабинет должен быть полноценным и информативным. Где
// человек состоит и кем — это его, а не компании: лента календарей
// (`list_my_calendars`) отдаёт по строке на КАЛЕНДАРЬ, здесь они собираются в
// компании. Какая компания «сейчас» — решает компания УСТРОЙСТВА: флаг сервера
// `isActive` сразу после перехода ещё прежний (см. `useCalendarChips`).

import type { MyCalendar } from "../settings/workspaces";
import { isUserRole, ROLE_LABELS, type UserRole } from "../settings/role-policy";

export interface CompanyCalendar {
  teamId: string;
  teamName: string;
  teamColor: string | null;
  grants: string[];
}

export interface CompanyMembership {
  tenantId: string;
  tenantName: string;
  role: UserRole | null;
  onboarded: boolean;
  isActive: boolean;
  calendars: CompanyCalendar[];
}

export function groupMemberships(
  calendars: readonly MyCalendar[],
  activeTenantId: string | null,
): CompanyMembership[] {
  const byTenant = new Map<string, CompanyMembership>();
  for (const row of calendars) {
    let company = byTenant.get(row.tenantId);
    if (!company) {
      company = {
        tenantId: row.tenantId,
        tenantName: row.tenantName.trim() || "Без названия",
        role: isUserRole(row.role) ? row.role : null,
        onboarded: row.onboarded,
        isActive: activeTenantId
          ? row.tenantId === activeTenantId
          : row.isActive,
        calendars: [],
      };
      byTenant.set(row.tenantId, company);
    }
    company.calendars.push({
      teamId: row.teamId,
      teamName: row.teamName,
      teamColor: row.teamColor,
      grants: row.grants,
    });
  }
  // Компания «сейчас» — первой; остальные в порядке ленты: сервер держит его
  // стабильным, а сортировка массива в JS устойчива.
  return [...byTenant.values()].sort(
    (a, b) => Number(b.isActive) - Number(a.isActive),
  );
}

function calendarsWord(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "календарь";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return "календаря";
  }
  return "календарей";
}

/** Подпись строки компании — состояние, а не пояснение: где я сейчас, кем я
 *  там и сколько у меня календарей. */
export function membershipSubtitle(company: CompanyMembership): string {
  const parts: string[] = [];
  if (company.isActive) parts.push("Сейчас здесь");
  if (company.role) parts.push(ROLE_LABELS[company.role]);
  const count = company.calendars.length;
  parts.push(`${count} ${calendarsWord(count)}`);
  return parts.join(" · ");
}

const GRANT_ORDER = [
  "view",
  "book",
  "edit_all",
  "clients",
  "phones",
  "finance",
  "settings",
] as const;

const GRANT_WORDS: Record<(typeof GRANT_ORDER)[number], string> = {
  view: "просмотр",
  book: "запись",
  edit_all: "все записи",
  clients: "клиенты",
  phones: "телефоны",
  finance: "деньги",
  settings: "настройки",
};

/** Что человеку открыто в календаре — словами продукта. Владельцу — всё;
 *  без выданных прав доступ пока задаёт роль (блоки прав ещё не включены). */
export function grantsSummary(
  role: UserRole | null,
  grants: readonly string[],
): string {
  if (role === "owner") return "Полный доступ";
  const words = GRANT_ORDER.filter((grant) => grants.includes(grant)).map(
    (grant) => GRANT_WORDS[grant],
  );
  if (words.length === 0) return "Доступ задаёт роль";
  const text = words.join(" · ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** «Без ограничений» в функциях квот базы — это 999 999 999. */
const UNLIMITED = 999_999_999;

const PLAN_LABELS: Record<string, string> = {
  free: "Бесплатный",
  pro: "Pro",
  business: "Business",
  lifetime: "Без ограничений",
  beta_unlimited: "Бета без ограничений",
};

/** Тариф словами — без цен: подписка продаётся на сайте, и в iOS цены и кнопки
 *  оплаты быть не может (App Store 3.1.3(f)). Незнакомый тариф печатается как
 *  есть, а не прячется. */
export function planLabel(plan: string | null | undefined): string {
  if (!plan) return "—";
  return PLAN_LABELS[plan] ?? plan;
}

/** Строка лимита: сколько использовано из скольких и сколько осталось. */
export function quotaLine(usage: { current: number; limit: number }): {
  value: string;
  sub: string;
} {
  if (usage.limit >= UNLIMITED) {
    return { value: String(usage.current), sub: "Без ограничений" };
  }
  const left = Math.max(0, usage.limit - usage.current);
  return {
    value: `${usage.current} из ${usage.limit}`,
    sub: left > 0 ? `Осталось ${left}` : "Лимит исчерпан",
  };
}
