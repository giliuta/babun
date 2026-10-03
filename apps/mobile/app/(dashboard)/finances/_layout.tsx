import { Stack, usePathname } from "expo-router";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useMyAccess } from "@/features/access/queries";
import { LockedFinances } from "@/features/finances/LockedFinances";
import { financesGate } from "@/features/finances/finances-gate";
import { anyFinanceSetting } from "@/features/finances/settings-levels";
import { useFinanceSettingLevelsOf } from "@/features/finances/use-finance-settings";
import { useTeams } from "@/features/reference/queries";
import { useBudgetWatch } from "@/features/finances/use-category-budget";
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
// ГЛАВНЫЙ ЭКРАН ВКЛАДКИ ВСЕГДА ПОД ЛЮБЫМ ЕЁ ЭКРАНОМ (владелец 2026-09-24:
// «открываю финансы, нажимаю „назад“ — перекидывает на календарь»). Экран
// вкладки, открытый снаружи — из календаря, из формы, дверью листа, по
// ссылке, — ложился в стек вкладки ОДИН, без её корня под собой, и «назад»
// уходил из вкладки на предыдущую. `initialRouteName` кладёт корень вниз
// при любом входе в стек; сторож — `tab-stack-roots.test.ts`.
export const unstable_settings = { initialRouteName: "index" };

/** Шестерёнка «Финансов» и её подстраницы. С 03.10 у каждой строки своё
 *  право (`settings-levels.ts`), а подстраницу закрывает дверь её строки
 *  (`FinanceSettingsRoute`) — прежний список «только владельцу» снят. */
const SETTINGS_PATHS = [
  "/finances/settings",
  "/finances/categories",
  "/finances/requisites",
  "/finances/invoice-blank",
  "/finances/deleted",
];

const onPath = (pathname: string, paths: readonly string[]) =>
  paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));

export default function FinancesLayout() {
  const role = useCurrentRole().data;
  const accessQuery = useMyAccess();
  const pathname = usePathname();
  const gate = financesGate(role, accessQuery.data);
  const levelsOf = useFinanceSettingLevelsOf();
  const teams = useTeams().data ?? [];
  const anySetting =
    anyFinanceSetting(levelsOf(null)) || teams.some((team) => anyFinanceSetting(levelsOf(team.id)));
  // Бюджеты категорий: пока раздел открыт, владелец узнаёт о перевале лимита
  // и по расходам с чужих телефонов (`use-category-budget.ts`).
  useBudgetWatch();

  // ШЕСТЕРЁНКА — НЕ ДЕНЬГИ: у партнёра без «Доходов» и «Расходов» бывают
  // открытые строки настроек (категории, счета). Серая страница вставала
  // вместо всего стека, и её же шестерёнка вела обратно на неё — петля.
  if (gate === "locked" && !(onPath(pathname, SETTINGS_PATHS) && anySetting)) {
    return <LockedFinances />;
  }

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

  if ((gate === "open" || gate === "locked") && role !== "owner") {
    return <Stack screenOptions={{ headerShown: false }} />;
  }

  return (
    <RoleCapabilityBoundary capability="view-finances" title="Финансы">
      <Stack screenOptions={{ headerShown: false }} />
    </RoleCapabilityBoundary>
  );
}
