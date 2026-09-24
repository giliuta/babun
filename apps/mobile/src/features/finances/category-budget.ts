// БЮДЖЕТ КАТЕГОРИИ НА МЕСЯЦ — ЧИСТАЯ ЛОГИКА (владелец 2026-09-24: «когда
// создам категорию, выставить бюджет по этой категории, и потом она просто
// пришлёт уведомление, что перевалил лимит»).
//
// Бюджет — свойство категории (`finance_categories.monthly_budget`), месяц —
// календарный месяц компании. Потрачено = сумма расходов этой категории за
// месяц по журналу; своей колонки у «потрачено» нет, иначе у расходов было бы
// две правды.
//
// ДВА ПОРОГА: 80% — «осталось немного», 100% — «исчерпан/превышен». Каждый
// порог сообщается ОДИН раз за месяц на категорию: что уже сказано, помнит
// устройство (`BudgetSeen`). Если расход удалили и сумма ушла ниже порога,
// порог снова «не сказан» — повторное превышение снова стоит уведомления.
//
// Лист без зависимостей от React и нативного — под `bun test`.

export type BudgetLevel = 0 | 80 | 100;

/** Что уже сообщено: `${categoryId}:${YYYY-MM}` → порог. */
export type BudgetSeen = Record<string, BudgetLevel>;

export interface BudgetCategory {
  id: string;
  name: string;
  type: string;
  monthly_budget: number | null;
  hidden?: boolean;
  is_system?: boolean;
}

export interface BudgetLedgerRow {
  type: string;
  amount: number;
  category_id: string | null;
}

export interface BudgetNotice {
  categoryId: string;
  level: Exclude<BudgetLevel, 0>;
  title: string;
  body: string;
}

export const BUDGET_WARN_SHARE = 0.8;

const pad = (n: number) => String(n).padStart(2, "0");

/** Границы календарного месяца дня `ymd` (включительно) и его ключ. */
export function monthOf(ymd: string): { from: string; to: string; key: string } {
  const [y, m] = ymd.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const key = `${y}-${pad(m)}`;
  return { from: `${key}-01`, to: `${key}-${pad(last)}`, key };
}

/** Есть ли у категории действующий бюджет. Бюджет бывает только у расхода. */
export function hasBudget(c: BudgetCategory): c is BudgetCategory & { monthly_budget: number } {
  return c.type === "expense" && !c.is_system && c.monthly_budget != null && c.monthly_budget > 0;
}

/** Потрачено за месяц по категориям. Сумма расхода в журнале положительна,
 *  но знак здесь не угадываем — берём модуль. */
export function monthSpendByCategory(rows: readonly BudgetLedgerRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (r.type !== "expense" || !r.category_id) continue;
    out.set(r.category_id, (out.get(r.category_id) ?? 0) + Math.abs(Number(r.amount) || 0));
  }
  return out;
}

/** Порог, до которого дошла сумма. Копейки не решают: сравнение в центах. */
export function budgetLevel(spent: number, budget: number): BudgetLevel {
  const s = Math.round(spent * 100);
  const b = Math.round(budget * 100);
  if (b <= 0) return 0;
  if (s >= b) return 100;
  if (s >= Math.round(b * BUDGET_WARN_SHARE)) return 80;
  return 0;
}

/** Короткая подпись в строке справочника: «€180 из €250». */
export function budgetShort(spent: number, budget: number, fmt: (n: number) => string): string {
  return `${fmt(spent)} из ${fmt(budget)}`;
}

/** Строка под выбранной категорией в форме операции: сколько осталось. */
export function budgetLeftLine(spent: number, budget: number, fmt: (n: number) => string): string {
  const left = budget - spent;
  if (Math.round(left * 100) > 0) return `Бюджет: осталось ${fmt(left)} из ${fmt(budget)}`;
  if (Math.round(left * 100) === 0) return `Бюджет ${fmt(budget)} исчерпан`;
  return `Сверх бюджета ${fmt(-left)} · бюджет ${fmt(budget)}`;
}

/** Текст уведомления о пороге. */
export function budgetNoticeText(
  name: string,
  spent: number,
  budget: number,
  level: Exclude<BudgetLevel, 0>,
  fmt: (n: number) => string,
): { title: string; body: string } {
  const left = budget - spent;
  if (level === 80) {
    return {
      title: `Бюджет «${name}» почти исчерпан`,
      body: `Потрачено ${fmt(spent)} из ${fmt(budget)} — осталось ${fmt(left)} до конца месяца.`,
    };
  }
  if (Math.round(left * 100) === 0) {
    return {
      title: `Бюджет «${name}» исчерпан`,
      body: `Потрачено ${fmt(spent)} из ${fmt(budget)} за этот месяц.`,
    };
  }
  return {
    title: `Бюджет «${name}» превышен`,
    body: `Потрачено ${fmt(spent)} из ${fmt(budget)} — сверх бюджета ${fmt(-left)}.`,
  };
}

/**
 * Что сообщить сейчас и что запомнить. Сообщается только ПОДЪЁМ порога:
 * 0→80 — «почти», 0→100 или 80→100 — «превышен» (одно уведомление, а не
 * два подряд). Запоминается текущий порог каждой категории с бюджетом за
 * ЭТОТ месяц; прошлые месяцы и снятые бюджеты из памяти уходят.
 */
export function budgetAlerts(
  categories: readonly BudgetCategory[],
  spend: ReadonlyMap<string, number>,
  seen: BudgetSeen,
  monthKey: string,
  fmt: (n: number) => string,
): { notices: BudgetNotice[]; next: BudgetSeen } {
  const notices: BudgetNotice[] = [];
  const next: BudgetSeen = {};
  for (const c of categories) {
    if (!hasBudget(c)) continue;
    const key = `${c.id}:${monthKey}`;
    const spent = spend.get(c.id) ?? 0;
    const level = budgetLevel(spent, c.monthly_budget);
    const before = seen[key] ?? 0;
    if (level > before && level !== 0) {
      notices.push({
        categoryId: c.id,
        level,
        ...budgetNoticeText(c.name, spent, c.monthly_budget, level, fmt),
      });
    }
    if (level !== 0) next[key] = level;
  }
  return { notices, next };
}

/** Поле «Бюджет в месяц»: пусто или ноль — бюджета нет; иначе число.
 *  `undefined` — набрано не число (форма покажет ошибку). */
export function parseBudgetInput(raw: string): number | null | undefined {
  const t = raw.replace(/\s/g, "").replace(",", ".");
  if (t === "") return null;
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return undefined;
  const n = Number(t);
  return n > 0 ? n : null;
}

/** Обратно в поле: 250 → «250», 99.5 → «99.5». */
export function budgetInputText(budget: number | null | undefined): string {
  return budget == null ? "" : String(Math.round(budget * 100) / 100);
}
