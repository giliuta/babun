import { Stack } from "expo-router";
import { LockedFinances } from "@/features/finances/LockedFinances";
import { financesGate } from "@/features/finances/finances-gate";
import { RoleCapabilityBoundary } from "@/features/settings/RoleCapabilityBoundary";
import { useCurrentRole } from "@/features/settings/tenant";

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
//
// БЕЗ ДОСТУПА К ФИНАНСАМ — СЕРАЯ СТРАНИЦА, А НЕ ГРАНИЦА (владелец 15.09: «если
// я перехожу в финансы — не „раздел недоступен“; всё серое, всё по нулям, но
// переключаться можно»). Она встаёт вместо ВСЕГО стека, поэтому и диплинк
// `/finances/vat` у такого человека приходит на неё, а не на ставки. Спиннер
// роли, «нет связи» и уход из компании по-прежнему решает граница
// (`financesGate` → `boundary`).
export default function FinancesLayout() {
  const role = useCurrentRole().data;
  if (financesGate(role) === "locked") return <LockedFinances />;
  return (
    <RoleCapabilityBoundary capability="view-finances" title="Финансы">
      <Stack screenOptions={{ headerShown: false }} />
    </RoleCapabilityBoundary>
  );
}
