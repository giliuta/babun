import CategoriesScreen from "../cabinet/categories";

// КАТЕГОРИИ ИЗ «НАСТРОЕК ФИНАНСОВ» — ВНУТРИ ВКЛАДКИ «ФИНАНСЫ» (прогон
// 2026-09-24). Строка вела на `/cabinet/categories`, и снизу загоралась
// вкладка «Кабинет»: человек зашёл в настройки денег, а приложение сказало,
// что он в кабинете, и «назад» из вкладки уводил не туда. Экран тот же, что в
// Кабинете и в общем стеке (`app/(shared)/categories.tsx`), — другой только
// адрес. Строку видит только владелец (`settings-rows.ts`), граница раздела —
// `finances/_layout.tsx`.
export default function FinanceCategoriesScreen() {
  return <CategoriesScreen />;
}
