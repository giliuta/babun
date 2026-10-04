// «История изменений» — Кабинет → Компания (владелец 03.10). Тело страницы —
// в `features/cabinet/HistoryScreen.tsx`.
import { CabinetAccountRoute } from "@/features/cabinet/CabinetAccountRoute";
import { HistoryScreen } from "@/features/cabinet/HistoryScreen";

// `?tenant=` — журнал аккаунта из его блока в Кабинете (04.10): партнёр с
// правом «История изменений» и свой аккаунт, открытый со стороны.
export default function CabinetHistoryRoute() {
  return (
    <CabinetAccountRoute>
      <HistoryScreen />
    </CabinetAccountRoute>
  );
}
