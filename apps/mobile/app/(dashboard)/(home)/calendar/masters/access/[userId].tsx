import { useLocalSearchParams, useRouter } from "expo-router";

import { MemberAccessScreen } from "@/features/access/MemberAccessScreen";

// ПРАВА СОТРУДНИКА ИЗ КАЛЕНДАРЯ — ДВЕРЬ, А НЕ ФОРМА (AGENTS, Canon Reuse п.3).
// Тело экрана живёт в `features/access`; маршрут только достаёт из адреса,
// кого и из какого календаря открыли. Календарь нужен в адресе, потому что
// календарные блоки у одного человека в разных календарях разные.
export default function MemberAccessRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ userId?: string | string[]; team?: string | string[] }>();
  const userId = Array.isArray(params.userId) ? params.userId[0] : params.userId;
  const team = Array.isArray(params.team) ? params.team[0] : params.team;
  if (!userId || !team) return null;
  return <MemberAccessScreen userId={userId} teamId={team} onBack={() => router.back()} />;
}
