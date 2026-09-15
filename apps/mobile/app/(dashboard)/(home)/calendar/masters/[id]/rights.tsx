import { Redirect, useLocalSearchParams, useRouter, type Href } from "expo-router";

import { MasterRightsPage } from "@/features/access/master-page/MasterRightsPage";
import { invitationIdFromSegment } from "@/features/access/master-page/master-draft";

// «ПРАВА» — СТРАНИЦА ВНУТРИ МАСТЕРА (владелец 15.09: «разрешения можно сделать
// отдельной страницей внутри уже мастера»). `new` — черновик нового мастера,
// `invite-<uuid>` — приглашение без ответа. У старой карточки без аккаунта
// прав нет: права ставятся человеку, а не карточке, — адрес ведёт на её хаб.
// Права сотрудника открываются из его карточки (`access/[userId]?rights=1`).

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default function MasterRightsRoute() {
  const params = useLocalSearchParams<{
    id: string;
    team?: string | string[];
    area?: string | string[];
  }>();
  const router = useRouter();
  const team = first(params.team);
  const area = first(params.area);
  const invitationId = invitationIdFromSegment(params.id);

  const back = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    const home =
      params.id === "new"
        ? team
          ? `/calendar/masters/new?team=${encodeURIComponent(team)}`
          : "/calendar/masters"
        : `/calendar/masters/${params.id}`;
    router.replace(home as Href);
  };

  if (params.id === "new") return <MasterRightsPage mode="draft" area={area} onBack={back} />;
  if (invitationId) {
    return (
      <MasterRightsPage mode="invite" invitationId={invitationId} area={area} onBack={back} />
    );
  }
  return <Redirect href={`/calendar/masters/${params.id}` as Href} />;
}
