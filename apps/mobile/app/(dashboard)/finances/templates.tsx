import TemplatesScreen from "../cabinet/templates";

// ШАБЛОНЫ ОПЕРАЦИЙ ИЗ «НАСТРОЕК ФИНАНСОВ» — ВНУТРИ ВКЛАДКИ «ФИНАНСЫ» (прогон
// 2026-09-24), по той же причине, что категории (`finances/categories.tsx`):
// адрес Кабинета подсвечивал чужую вкладку. Экран тот же.
export default function FinanceTemplatesScreen() {
  return <TemplatesScreen />;
}
