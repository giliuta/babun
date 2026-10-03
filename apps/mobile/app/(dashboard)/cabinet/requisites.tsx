import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useAccountGate, useAccountScope } from "@/features/cabinet/account-scope";
import { CabinetAccountRoute } from "@/features/cabinet/CabinetAccountRoute";
import { FinanceSettingsRoute } from "@/features/finances/FinanceSettingsRoute";
import { RequisitesScreen } from "@/features/companies/RequisitesScreen";

// РЕКВИЗИТЫ — ТОНКИЙ МАРШРУТ НАД СТРАНИЦЕЙ СПРАВОЧНИКА: экран держит только
// адрес, всё остальное живёт в `features/companies/RequisitesScreen.tsx`.
//
// АДРЕС — В КАБИНЕТЕ (владелец 2026-10-03: «запихни реквизиты компании в
// кабинет — это единый блок на все компании»). До этого страница жила за
// шестерёнкой «Финансов» (`/finances/requisites`, решение 2026-09-21).
// Документы зовут ту же страницу поверх себя — `app/(shared)/requisites.tsx`.
//
// ДВЕРЬ — ПРАВО СТРОКИ «Реквизиты» (03.10): партнёр с «Только видит» видит
// наборы без правки (страница гасит правку не владельцу сама). С `?tenant=` —
// реквизиты аккаунта, который пригласил (блок аккаунта в Кабинете, 04.10), и
// право — в нём, а не в аккаунте, открытом на телефоне.
export default function CabinetRequisitesRoute() {
  return (
    <CabinetAccountRoute>
      <RequisitesDoor />
    </CabinetAccountRoute>
  );
}

function RequisitesDoor() {
  const scope = useAccountScope();
  const gate = useAccountGate("finance.settings_requisites");
  if (!scope.foreign) {
    return (
      <FinanceSettingsRoute row="requisites" title="Реквизиты">
        <RequisitesScreen />
      </FinanceSettingsRoute>
    );
  }
  if (gate === "read" || gate === "write") return <RequisitesScreen />;
  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Реквизиты" />
      <EmptyState fill state={gate === "loading" ? "loading" : undefined} title={gate === "loading" ? undefined : "Настроек пока нет"} />
    </Screen>
  );
}
