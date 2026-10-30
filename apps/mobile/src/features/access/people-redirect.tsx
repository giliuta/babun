import { Redirect, useLocalSearchParams, usePathname, type Href } from "expo-router";

// СТАРЫЕ АДРЕСА ПАРТНЁРОВ. Партнёры живут в шестерёнке календаря
// (`/calendar/partners/…`): туда приглашают прямо в календарь. Старые ссылки
// `/cabinet/people/…` (закладки, ссылки прежних сборок) ведут на тот же
// экран по новому адресу с теми же параметрами.
export function CabinetPeopleRedirect() {
  const pathname = usePathname();
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const path = pathname.replace(/^\/cabinet\/people/, "/calendar/partners");
  // Параметры пути (`[id]`, `[userId]`) уже стоят в адресе — в запрос идут
  // только остальные.
  const query = Object.entries(params)
    .filter(([key]) => key !== "id" && key !== "userId")
    .flatMap(([key, value]) => (Array.isArray(value) ? value : [value]).map((v) => `${encodeURIComponent(key)}=${encodeURIComponent(v)}`))
    .join("&");
  return <Redirect href={(query ? `${path}?${query}` : path) as Href} />;
}
