import { useLocalSearchParams } from "expo-router";
import { ServicesList } from "../../services";

// Услуги команды — web parity teams/[id]/services. Тонкая обёртка над
// общим экраном услуг: тот же CRUD/редактор, но список сужен до услуг
// этой бригады, а «Добавить» сразу привязывает её (lockedTeamId).
export default function TeamServicesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ServicesList teamId={id} />;
}
