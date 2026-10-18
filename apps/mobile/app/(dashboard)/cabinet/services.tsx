import { useLocalSearchParams } from "expo-router";
import { ServicesList } from "@/features/services/price-list/ServicesList";

// «Услуги» — the price list. The body lives in `src/features/services/price-list/`;
// `calendar/services.tsx` and `(shared)/services.tsx` reuse this route.
export { ServicesList };

export default function ServicesScreen() {
  // КОМАНДА ПРИХОДИТ АДРЕСОМ И ЭТО ГЛАВНАЯ ДВЕРЬ. Дверь из настроек календаря
  // открывается уже с командой, чьи настройки человек и правит: без этого он
  // выбирал Команду 2 в ленте календаря, тапал «Услуги» и попадал в прайс
  // Команды 1 — а заведённая там услуга уезжала чужой команде.
  const params = useLocalSearchParams<{ team?: string | string[] }>();
  const team = Array.isArray(params.team) ? params.team[0] : params.team;
  return <ServicesList teamId={team?.trim() || undefined} />;
}
