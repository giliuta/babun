import { Redirect, Stack, usePathname } from "expo-router";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useMyAccess } from "@/features/access/queries";
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
//
// ОТКРЫВАЕТ УРОВЕНЬ, А НЕ РОЛЬ (этап 2, владелец 15.09: «чтоб всё сразу
// менялось в живом времени»). Сотрудник с «Доходами и расходами» получает
// финансы без роли владельца, а смена его прав приходит сигналом и
// перерисовывает ворота сразу. Граница роли остаётся только владельцу — у
// сотрудника её роль закрыла бы то, что открыл уровень.
/** Экраны каталога, которые в срезе 1 остаются ВЛАДЕЛЬЧЕСКИМИ: денежные
 *  настройки, НДС компании и команды, список документов. Уровни их не
 *  открывают, поэтому сотруднику они не «недоступны», а просто не существуют —
 *  диплинк приходит на сами «Финансы». */
const OWNER_ONLY_PATHS = [
  // «/finances/settings» отсюда УШЛА (владелец 20.09: «я могу зайти туда, но
  // блоков уже внутри шестерёнки не будет»). Страница открыта всем, а строки
  // на ней показывает `finances/settings-rows.ts`; вторые ступени — ставки,
  // бланк счёта и список документов — остаются владельческими: к ним ведут
  // строки, которых у сотрудника нет.
  "/finances/vat",
  "/finances/vat-team",
  "/finances/invoices",
];

export default function FinancesLayout() {
  const role = useCurrentRole().data;
  const accessQuery = useMyAccess();
  const pathname = usePathname();
  const gate = financesGate(role, accessQuery.data);

  if (gate === "locked") return <LockedFinances />;

  if (gate === "loading") {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Финансы" />
        {accessQuery.isError ? (
          <EmptyState
            state="error"
            fill
            title="Нет связи с сервером"
            subtitle="Права подтвердим, как только появится интернет."
            action={{ label: "Повторить", onPress: () => void accessQuery.refetch() }}
          />
        ) : (
          <EmptyState state="loading" fill />
        )}
      </Screen>
    );
  }

  if (gate === "open" && role !== "owner") {
    if (OWNER_ONLY_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
      return <Redirect href="/finances" />;
    }
    return <Stack screenOptions={{ headerShown: false }} />;
  }

  return (
    <RoleCapabilityBoundary capability="view-finances" title="Финансы">
      <Stack screenOptions={{ headerShown: false }} />
    </RoleCapabilityBoundary>
  );
}
