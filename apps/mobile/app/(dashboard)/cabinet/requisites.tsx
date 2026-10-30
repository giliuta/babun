// СТАРЫЙ АДРЕС РЕКВИЗИТОВ. Реквизиты живут в шестерёнке «Финансов» у каждого
// календаря (`/finances/requisites`); сюда ведут старые ссылки.
import { Redirect } from "expo-router";

export default function CabinetRequisitesRedirect() {
  return <Redirect href="/finances/requisites" />;
}
