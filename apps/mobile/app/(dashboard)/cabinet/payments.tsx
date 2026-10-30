// СТАРЫЙ АДРЕС ОПЛАТ ТАРИФА. Оплаты — у каждого календаря, на странице его
// тарифа (`/calendar/tariff` → «Оплаты»); сюда ведут старые ссылки.
import { Redirect } from "expo-router";

export default function CabinetPaymentsRedirect() {
  return <Redirect href="/calendar/tariff" />;
}
