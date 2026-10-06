// «Оплаты тарифа» — платежи за подписку (Кабинет, владелец 03.10). Тело —
// `features/cabinet/TariffPaymentsScreen.tsx`. С `?tenant=` — оплаты аккаунта,
// который пригласил (04.10), по праву «Оплаты тарифа».
//
// Только на сайте: страница открывает счета Stripe с формой оплаты, а в
// приложении из магазина покупок нет (App Store 3.1.3(f), `pay-here.ts`).
// Строки к ней там нет; старая ссылка возвращает в Кабинет.
import { Redirect } from "expo-router";
import { CabinetAccountRoute } from "@/features/cabinet/CabinetAccountRoute";
import { TariffPaymentsScreen } from "@/features/cabinet/TariffPaymentsScreen";
import { CAN_PAY_HERE } from "@/lib/pay-here";

export default function CabinetPaymentsRoute() {
  if (!CAN_PAY_HERE) return <Redirect href="/cabinet" />;
  return (
    <CabinetAccountRoute>
      <TariffPaymentsScreen />
    </CabinetAccountRoute>
  );
}
