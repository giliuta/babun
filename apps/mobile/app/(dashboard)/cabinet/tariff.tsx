// КАБИНЕТ → ТАРИФ — «Соло · Про · Макс», пробный 14 дней и оплата в браузере.
// Тело — в features/tariffs. С `?tenant=` — тариф аккаунта,
// который пригласил (блок аккаунта в Кабинете): партнёр видит его и
// платит за него по праву «Тариф».
import { CabinetAccountRoute } from "@/session/CabinetAccountRoute";
import { TariffScreen } from "@/features/tariffs/TariffScreen";

export default function CabinetTariffRoute() {
  return (
    <CabinetAccountRoute>
      <TariffScreen />
    </CabinetAccountRoute>
  );
}
