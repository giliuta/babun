import type { FinanceTemplate } from "@babun/shared/db/repositories/finance-templates";

// КАКИЕ ШАБЛОНЫ ПРЕДЛАГАЕТ ФОРМА ОПЕРАЦИИ (прогон финансов 2026-09-24).
//
// Шаблон привязан к команде — её счёт и способ оплаты в нём уже решены.
// Шаблон чужой команды в форме этой команды вёл бы деньги мимо неё, поэтому
// он не предлагается. Шаблон без команды (наследие старой схемы) подходит
// всем. Команда формы не выбрана — предлагать нечего: счёт шаблона не с чем
// сверить.
//
// Порядок — по имени: список короткий, и искать в нём глазами проще по
// алфавиту, чем по дате заведения.
const byName = new Intl.Collator("ru", { sensitivity: "base" });

export function templatesForSheet<
  T extends Pick<FinanceTemplate, "name" | "brigade_id">,
>(templates: readonly T[], teamId: string | null): T[] {
  if (!teamId) return [];
  return templates
    .filter((tpl) => tpl.brigade_id === null || tpl.brigade_id === teamId)
    .sort((a, b) => byName.compare(a.name, b.name));
}
