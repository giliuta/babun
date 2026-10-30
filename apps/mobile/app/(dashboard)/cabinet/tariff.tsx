// СТАРЫЙ АДРЕС ТАРИФА. Тариф — у календаря, в его шестерёнке
// (`/calendar/tariff`); сюда ведут старые ссылки и страница «Оплата прошла»
// прежних сборок.
import { Redirect } from "expo-router";

export default function CabinetTariffRedirect() {
  return <Redirect href="/calendar/tariff" />;
}
