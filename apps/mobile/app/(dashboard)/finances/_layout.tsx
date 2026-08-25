import { Stack } from "expo-router";
import { RoleCapabilityBoundary } from "@/features/settings/RoleCapabilityBoundary";

// Раздел «Финансы» — ОДНА вкладка со стеком внутри, как «Клиенты».
//
// Без этого файла expo-router считает каждый файл каталога отдельной
// вкладкой, и внизу вырастают «finances/settings», «finances/vat» рядом с
// «Календарь» и «Клиенты». Стек-раскладка склеивает их в один таб: список
// денег — корень, настройки и НДС — экраны поверх него.
//
// ГРАНИЦА ПРАВ СТОИТ ЗДЕСЬ, А НЕ НА КОРНЕВОМ ЭКРАНЕ. Пока она жила внутри
// finances/index.tsx, диплинк `/finances/vat` и `/finances/settings` открывал
// налоговые ставки и денежные настройки любой ролью: гейт корня к соседним
// экранам стека отношения не имеет. Одна граница на каталог закрывает и те,
// что появятся здесь завтра.
export default function FinancesLayout() {
  return (
    <RoleCapabilityBoundary capability="view-finances" title="Финансы">
      <Stack screenOptions={{ headerShown: false }} />
    </RoleCapabilityBoundary>
  );
}
