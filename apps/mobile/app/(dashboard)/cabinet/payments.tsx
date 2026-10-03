// «Оплаты тарифа» — платежи за подписку (Кабинет, владелец 03.10). Тело —
// `features/cabinet/TariffPaymentsScreen.tsx`. С `?tenant=` — оплаты аккаунта,
// который пригласил (04.10), по праву «Оплаты тарифа».
import { CabinetAccountRoute } from "@/features/cabinet/CabinetAccountRoute";
import { TariffPaymentsScreen } from "@/features/cabinet/TariffPaymentsScreen";

export default function CabinetPaymentsRoute() {
  return (
    <CabinetAccountRoute>
      <TariffPaymentsScreen />
    </CabinetAccountRoute>
  );
}
