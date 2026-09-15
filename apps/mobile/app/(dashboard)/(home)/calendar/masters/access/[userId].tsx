import { useLocalSearchParams, useRouter, type Href } from "expo-router";

import { MasterCard } from "@/features/access/master-page/MasterCard";
import { MasterRightsPage } from "@/features/access/master-page/MasterRightsPage";

// СОТРУДНИК ИЗ КАЛЕНДАРЯ — ДВЕРЬ, А НЕ ФОРМА (AGENTS, Canon Reuse п.3). Тело —
// карточка мастера (`features/access/master-page`); маршрут только достаёт из
// адреса, кого и из какого календаря открыли. `?rights=1` — его «Права» в том
// же файле маршрута: новый файл перезагрузил бы бандл у всех девайсов общего
// Metro. Календарь в адресе — какой открыть первым: календарные блоки у
// одного человека в разных календарях разные.

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default function MemberAccessRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    userId?: string | string[];
    team?: string | string[];
    rights?: string | string[];
    area?: string | string[];
  }>();
  const userId = first(params.userId);
  const team = first(params.team) || null;
  if (!userId) return null;

  const back = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(
      (team ? `/calendar/masters?team=${encodeURIComponent(team)}` : "/calendar/masters") as Href,
    );
  };

  if (first(params.rights) === "1") {
    return (
      <MasterRightsPage
        mode="member"
        userId={userId}
        teamId={team}
        area={first(params.area)}
        onBack={back}
      />
    );
  }
  return <MasterCard mode="member" userId={userId} teamId={team} onBack={back} />;
}
