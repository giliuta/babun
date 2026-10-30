// ОПЛАТЫ КАЛЕНДАРЯ — платежи за его подписку, со страницы тарифа календаря.
// Тело — `features/cabinet/TariffPaymentsScreen.tsx`.
//
// Только там, где платят: страница открывает счета Stripe с формой оплаты, а
// в приложении из магазина покупок нет (App Store 3.1.3(f), `pay-here.ts`).
// Строки к ней там нет; старая ссылка возвращает к тарифу.
import { Redirect } from "expo-router";
import { TariffPaymentsScreen } from "@/features/cabinet/TariffPaymentsScreen";
import { CAN_PAY_HERE } from "@/lib/pay-here";

export default function CalendarTariffPaymentsRoute() {
  if (!CAN_PAY_HERE) return <Redirect href="/calendar/tariff" />;
  return <TariffPaymentsScreen />;
}
