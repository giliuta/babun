import type { MemberAccessMap } from "@/features/access/access-map";
import { accessGate } from "@/features/access/my-access";
import type { UserRole } from "@/features/settings/role-policy";

// «НАСТРОЙКИ ФИНАНСОВ» ПО ПРАВАМ (владелец 03.10: «сделай полноценно страницу
// доступа в финансах… как делали другие страницы»). Тот же закон, что у
// шестерёнки клиентов (`clients/settings-levels.ts`): страница одна для всех,
// владелец правит всё, партнёру строки открываются правом строки в команде —
// «Скрыты» — строки нет, «Только видит» — страница без правки, «Видит и
// меняет» — правит. Правку пускает сервер (политики `accounts`,
// `finance_categories`, `deleted_operations`, профиль компании — миграции
// 20261003171500 и 20261003235500), здесь — только вид.
//
// Строки шестерёнки — в её порядке и её блоками: «Деньги» (счета, удалённые
// операции; «Выгрузку для бухгалтера» владелец удалил 03.10), «Категории» (доходы, расходы, долги), «Документы»
// (реквизиты, инвойсы), «Общие» (валюта). Последние три — одни на весь
// аккаунт: право на компанию, и партнёр их только видит.
//
// Лист без React: правило читают страница, её подстраницы и тест.

export const FINANCE_SETTING_BLOCKS = {
  accounts: "finance.settings_accounts",
  trash: "finance.settings_trash",
  categoriesIncome: "finance.settings_categories_income",
  categoriesExpense: "finance.settings_categories_expense",
  categoriesDebts: "finance.settings_categories_debts",
  requisites: "finance.settings_requisites",
  currency: "finance.settings_currency",
} as const;

export type FinanceSettingRow = keyof typeof FINANCE_SETTING_BLOCKS;
export type FinanceSettingLevel = "hidden" | "read" | "write";
export type FinanceSettingLevels = Record<FinanceSettingRow, FinanceSettingLevel>;

/** Строки на весь аккаунт: их право — без команды. */
const COMPANY_ROWS: ReadonlySet<FinanceSettingRow> = new Set(["requisites", "currency"]);

const ROWS = Object.keys(FINANCE_SETTING_BLOCKS) as FinanceSettingRow[];

const ALL = (level: FinanceSettingLevel): FinanceSettingLevels =>
  Object.fromEntries(ROWS.map((row) => [row, level])) as FinanceSettingLevels;

/** Вид категорий → строка шестерёнки. */
export const CATEGORY_KIND_ROW = {
  income: "categoriesIncome",
  expense: "categoriesExpense",
  debt: "categoriesDebts",
} as const satisfies Record<"income" | "expense" | "debt", FinanceSettingRow>;

export interface FinanceSettingsInput {
  /** `undefined` — роль ещё не пришла. */
  role: UserRole | null | undefined;
  map: MemberAccessMap | undefined;
  teamId: string | null;
}

/** Положение каждой строки шестерёнки в этой команде. */
export function financeSettingLevels({ role, map, teamId }: FinanceSettingsInput): FinanceSettingLevels {
  if (role === "owner" || map?.isOwner) return ALL("write");
  // Права по блокам — у партнёра (роль `master`); прочим ролям, как и в
  // шестерёнке клиентов, строк нет. Пока карта не пришла — тоже нет: строка
  // не мигает открытой, чтобы тут же пропасть.
  if (role !== "master" || !map) return ALL("hidden");
  const levels = ALL("hidden");
  for (const row of ROWS) {
    const company = COMPANY_ROWS.has(row);
    // Строка команды без команды не открывается: выбрать её не из чего.
    if (!company && !teamId) continue;
    const gate = accessGate({
      role,
      map,
      blockKey: FINANCE_SETTING_BLOCKS[row],
      scope: company ? "company" : "calendar",
      teamId,
    });
    // Строки на весь аккаунт партнёр только видит, что бы ни стояло в карте.
    levels[row] = gate === "write" ? (company ? "read" : "write") : gate === "read" ? "read" : "hidden";
  }
  return levels;
}

/** «РЕКВИЗИТЫ» — В КАБИНЕТЕ (владелец 2026-10-03: «реквизиты — единый блок
 *  на все компании, запихни в кабинет»). Право строки прежнее и закрывает
 *  страницу `/cabinet/requisites`, но шестерёнку «Финансов» оно больше не
 *  открывает: строки там нет. */
const OUTSIDE_GEAR: ReadonlySet<FinanceSettingRow> = new Set(["requisites"]);

/** Есть ли у команды хоть одна строка — иначе её нет и в ленте. */
export function anyFinanceSetting(levels: FinanceSettingLevels): boolean {
  return ROWS.some((row) => !OUTSIDE_GEAR.has(row) && levels[row] !== "hidden");
}
