import { useEffect, useState } from "react";
import { Redirect, useLocalSearchParams, useRouter, type Href } from "expo-router";

import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { MasterCard } from "@/features/access/master-page/MasterCard";
import { MasterCardOnly } from "@/features/access/master-page/MasterCardOnly";
import {
  openMasterDraftFromCard,
  readMasterDraft,
} from "@/features/access/master-page/draft-store";
import { invitationIdFromSegment } from "@/features/access/master-page/master-draft";
import { cardTeamIds } from "@/features/access/masters-list";
import { formatPhoneAsYouType } from "@/features/clients/phone";
import { useMaster, useTeams } from "@/features/reference/queries";

// ОДНА ДВЕРЬ НА ЧЕЛОВЕКА (STORY-087; владелец 23.09: «страница мастера в
// календаре — полная хуетень… собери заново по законам»). Здесь жил старый
// хаб карточки — аватар, «Информация», «Визиты», «Статистика», тумблер архива,
// и ни слова о правах: из общего списка «Мастера» сотрудник с аккаунтом
// открывался именно им, и права были недостижимы.
//
// Теперь адрес ведёт на ОДНУ страницу человека:
//   • `new` — черновик нового мастера (и приглашение по карточке);
//   • `invite-<uuid>` — приглашение без ответа;
//   • карточка с аккаунтом — страница сотрудника (`access/[userId]`);
//   • карточка без аккаунта — та же страница с дверью «Пригласить в CRM».
export default function MasterRoute() {
  const params = useLocalSearchParams<{
    id: string;
    team?: string | string[];
    card?: string | string[];
  }>();
  const router = useRouter();
  const team = Array.isArray(params.team) ? params.team[0] : params.team;
  const card = Array.isArray(params.card) ? params.card[0] : params.card;
  const invitationId = invitationIdFromSegment(params.id);
  const back = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(
      (team ? `/calendar/masters?team=${encodeURIComponent(team)}` : "/calendar/masters") as Href,
    );
  };
  if (params.id === "new") {
    if (card) return <CardInviteDraft cardId={card} team={team ?? null} onBack={back} />;
    return <MasterCard mode="draft" teamId={team || null} onBack={back} />;
  }
  if (invitationId) return <MasterCard mode="invite" invitationId={invitationId} onBack={back} />;
  return <MasterByCard cardId={params.id} team={team ?? null} onBack={back} />;
}

/** «Пригласить в CRM» по карточке. Черновик кладёт карточка перед переходом;
 *  если его нет (адрес открыт заново, приложение перезапущено) — собираем
 *  из самой карточки, а не показываем пустой «Новый мастер». */
function CardInviteDraft({
  cardId,
  team,
  onBack,
}: {
  cardId: string;
  team: string | null;
  onBack: () => void;
}) {
  const cardQuery = useMaster(cardId);
  const teamsQuery = useTeams();
  const card = cardQuery.data;
  const [ready, setReady] = useState(() => readMasterDraft()?.masterId === cardId);
  useEffect(() => {
    if (ready || !card || !teamsQuery.data) return;
    const teamIds = cardTeamIds(card, teamsQuery.data);
    openMasterDraftFromCard({
      teamId: team || teamIds[0] || null,
      masterId: card.id,
      name: card.full_name || "",
      phone: card.phone ? formatPhoneAsYouType(card.phone) : "",
      teamIds,
    });
    setReady(true);
  }, [ready, card, teamsQuery.data, team]);
  // Карточка уже с аккаунтом — звать некого: её страница.
  if (card?.user_id) return <MasterByCard cardId={cardId} team={team} onBack={onBack} />;
  if (!ready) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Пригласить в CRM" onBack={onBack} />
        {cardQuery.isLoading || teamsQuery.isLoading ? (
          <EmptyState state="loading" fill />
        ) : (
          <EmptyState fill title="Мастер не найден" />
        )}
      </Screen>
    );
  }
  const teamId = readMasterDraft()?.teamId ?? team;
  return <MasterCard mode="draft" teamId={teamId || null} cardId={cardId} onBack={onBack} />;
}

function MasterByCard({
  cardId,
  team,
  onBack,
}: {
  cardId: string;
  team: string | null;
  onBack: () => void;
}) {
  const cardQuery = useMaster(cardId);
  const card = cardQuery.data;
  if (cardQuery.isLoading) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Мастер" onBack={onBack} />
        <EmptyState state="loading" fill />
      </Screen>
    );
  }
  // Человек с аккаунтом — его страница сотрудника, с правами и календарями.
  if (card?.user_id) {
    const home = team || card.team_id || "";
    return (
      <Redirect
        href={`/calendar/masters/access/${card.user_id}?team=${encodeURIComponent(home)}` as Href}
      />
    );
  }
  return <MasterCardOnly cardId={cardId} onBack={onBack} />;
}
