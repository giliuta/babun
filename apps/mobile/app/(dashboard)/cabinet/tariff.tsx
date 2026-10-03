// КАБИНЕТ → ТАРИФ — «Соло · Про · Макс», пробный 14 дней и оплата в браузере
// (владелец 01.10). Тело — в features/tariffs. С `?tenant=` — тариф аккаунта,
// который пригласил (блок аккаунта в Кабинете, 04.10): партнёр видит его и
// платит за него по праву «Тариф».
import { CabinetAccountRoute } from "@/features/cabinet/CabinetAccountRoute";
import { TariffScreen } from "@/features/tariffs/TariffScreen";

export default function CabinetTariffRoute() {
  return (
    <CabinetAccountRoute>
      <TariffScreen />
    </CabinetAccountRoute>
  );
}
