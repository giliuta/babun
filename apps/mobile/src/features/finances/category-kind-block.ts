import type { FinanceCategory } from "@babun/shared/db/repositories/finance-categories";

// ЧТО ПОКАЗАТЬ В БЛОКЕ ВИДА КАТЕГОРИЙ ШЕСТЕРЁНКИ (`CategoryKindBlock`).
// Чистое правило, чтобы его стерёг тест: три первые видимые — тем же
// порядком, что на странице вида (рука владельца, потом имя), а «Ещё N»
// считает всё остальное, скрытые тоже: они живут на странице, и дверь туда
// не должна врать, что там пусто.

/** Сколько категорий блок показывает плашками. */
export const KIND_BLOCK_LIMIT = 3;

export function kindBlockRows(categories: readonly FinanceCategory[]): {
  shown: FinanceCategory[];
  more: number;
  total: number;
} {
  // Служебные категории сервера («Услуги» оплаты записи, «Возврат») руками не
  // выбирают — их нет ни на странице, ни здесь.
  const own = categories.filter((c) => !c.is_system);
  const shown = own
    .filter((c) => !c.hidden)
    .sort(
      (a, b) =>
        a.position - b.position || a.name.localeCompare(b.name, "ru", { sensitivity: "base" }),
    )
    .slice(0, KIND_BLOCK_LIMIT);
  return { shown, more: own.length - shown.length, total: own.length };
}
