// «История изменений» — Кабинет → Компания. Тело страницы —
// в `features/cabinet/HistoryScreen.tsx`.
import { CabinetAccountRoute } from "@/session/CabinetAccountRoute";
import { HistoryScreen } from "@/features/cabinet/HistoryScreen";

// `?tenant=` — журнал аккаунта из его блока в Кабинете: партнёр с
// правом «История изменений» и свой аккаунт, открытый со стороны.
export default function CabinetHistoryRoute() {
  return (
    <CabinetAccountRoute>
      <HistoryScreen />
    </CabinetAccountRoute>
  );
}
