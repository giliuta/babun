import { useLocalSearchParams } from "expo-router";
import { CATEGORY_KIND_ROW } from "@/features/finances/settings-levels";
import { FinanceSettingsRoute } from "@/features/finances/FinanceSettingsRoute";
import CategoriesScreen from "../cabinet/categories";

// КАТЕГОРИИ ИЗ «НАСТРОЕК ФИНАНСОВ» — ВНУТРИ ВКЛАДКИ «ФИНАНСЫ». Адрес
// `/cabinet/categories` зажёг бы снизу вкладку «Кабинет»: человек зашёл в
// настройки денег, а приложение сказало бы, что он в кабинете, и «назад» из
// вкладки уводил бы не туда. Экран тот же, что в
// Кабинете и в общем стеке (`app/(shared)/categories.tsx`), — другой только
// адрес.
//
// ДВЕРЬ — ПРАВО ВИДА: страница одного вида (`?kind=`) открыта, если
// открыта его строка шестерёнки («Доходы», «Расходы», «Долги»); без вида —
// если открыта хоть одна.
export default function FinanceCategoriesScreen() {
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  const row =
    kind === "income" || kind === "expense" || kind === "debt"
      ? CATEGORY_KIND_ROW[kind]
      : Object.values(CATEGORY_KIND_ROW);
  return (
    <FinanceSettingsRoute row={row} title="Категории">
      <CategoriesScreen />
    </FinanceSettingsRoute>
  );
}
