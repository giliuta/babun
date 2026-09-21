import type { UserRole } from "@/features/settings/role-policy";

// СТРАНИЦА «НАСТРОЙКИ ФИНАНСОВ» ОТКРЫВАЕТСЯ ВСЕМ, СТРОКИ В НЕЙ — ПО ДОСТУПУ.
//
// Владелец 20.09, про весь продукт: «визуал целой страницы мы полностью
// сохраняем, а потом просто отключаем, что будет работать, а что нет, — но
// оно всё идентично выглядит… я могу зайти туда, но блоков уже внутри
// шестерёнки не будет».
//
// Раньше шестерёнка «Финансов» была серой и не нажималась, а прямая ссылка на
// `/finances/settings` уводила обратно на «Финансы». Теперь дверь открыта, а
// содержимое решает доступ — ровно как в настройках календаря
// (`calendar/settings-rows.ts`).
//
// Все строки этой страницы — настройки КОМПАНИИ (счета, категории, шаблоны,
// VAT, бланк счёта, реквизиты). Уровни доступа их пока не открывают: блоки
// `finance.categories`, `finance.templates`, `finance.vat` и `finance.documents`
// на сервере не живые. Поэтому
// сегодня строки видит владелец, а сотрудник — ту же страницу без строк.
// Когда блоки станут живыми, уровни придут сюда, и страница не изменится.

/** Что показывает страница настроек финансов этому человеку. */
export interface FinanceSettingsRows {
  accounts: boolean;
  categories: boolean;
  templates: boolean;
  vat: boolean;
  invoices: boolean;
  requisites: boolean;
  /** Заголовок «Деньги»: без своих строк он не рисуется — подпись над
   *  пустотой читается как сломанный экран. */
  moneyGroup: boolean;
  /** Заголовок «Документы». */
  documentsGroup: boolean;
  /** Ни одной строки: страница остаётся собой — шапка «Настройки финансов». */
  any: boolean;
}

export function financeSettingsRows(
  role: UserRole | null | undefined,
): FinanceSettingsRows {
  // Отдельной способности «править денежные настройки» в продукте нет:
  // страница целиком владельческая (счета компании, ставки, бланк счёта).
  // Спрашиваем роль так же, как настройки календаря, — одним диалектом.
  const owner = role === "owner";
  const money = { accounts: owner, categories: owner, templates: owner };
  const documents = { vat: owner, invoices: owner, requisites: owner };
  const moneyGroup = Object.values(money).some(Boolean);
  const documentsGroup = Object.values(documents).some(Boolean);
  return {
    ...money,
    ...documents,
    moneyGroup,
    documentsGroup,
    any: moneyGroup || documentsGroup,
  };
}
