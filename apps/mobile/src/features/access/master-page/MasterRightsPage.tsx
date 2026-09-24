import { useState } from "react";

import { useToast } from "@/components/ui/Toast";
import { phoneToSave } from "@/features/profile/profile";
import { useTeams } from "@/features/reference/queries";

import { useAccessBlocks } from "../queries";
import { updateMasterDraft, useMasterDraft } from "./draft-store";
import { useUpdateMasterInvitation } from "./invitation-api";
import { invitationRefusalText, isInvitationGone } from "./invitation-contract";
import { usePendingInvitation } from "./MasterInviteCard";
import { MasterRightsView, focusViewProps, type RightsFocus } from "./MasterRightsView";
import { MemberRights } from "./MemberRights";
import { RightsPlaceholder, activeOf, liveIdsOf, usePreview } from "./rights-page-shared";
import {
  draftFromInvitation,
  invitationCarriesCardFields,
  invitationRequest,
  visibleLevel,
  withLevel,
  withLiveTeams,
} from "./master-draft";
import { rightsAreaOf } from "./rights-rows";

// «ПРАВА» ВНУТРИ КАРТОЧКИ МАСТЕРА — ТРИ ИСТОЧНИКА, ОДНА СТРАНИЦА. Что куда
// ложится при выборе положения:
//   • draft  — в черновик (`draft-store`), уйдёт с «Пригласить»;
//   • invite — в приглашение (`update_invitation`), сразу, с откатом при отказе;
//   • member — в права сотрудника (`set_member_access`), сразу, с откатом.

export type MasterRightsPageProps = (
  | { mode: "draft"; area?: string; onBack: () => void }
  | { mode: "invite"; invitationId: string; area?: string; onBack: () => void }
  | { mode: "member"; userId: string; teamId: string | null; area?: string; onBack: () => void }
) & { focus?: RightsFocus };

/** Включить зеркало и уйти в продукт. Имя в плашке — как на карточке; роль в
 *  зеркале всегда сотрудничья (владельцем человек не бывает, иначе экраны
 *  открыли бы всё). Календарь в плашке — тот, что выбран чипом: уровни
 *  считаются по нему. */
export function MasterRightsPage(props: MasterRightsPageProps) {
  switch (props.mode) {
    case "invite":
      return (
        <InviteRights
          invitationId={props.invitationId}
          area={props.area}
          focus={props.focus}
          onBack={props.onBack}
        />
      );
    case "member":
      return (
        <MemberRights
          userId={props.userId}
          teamId={props.teamId}
          area={props.area}
          focus={props.focus}
          onBack={props.onBack}
        />
      );
    default:
      return <DraftRights area={props.area} focus={props.focus} onBack={props.onBack} />;
  }
}

/** Страница, которой пока нечего показать: едет, отказ или черновика нет. */

function DraftRights({
  area,
  focus,
  onBack,
}: {
  area?: string;
  focus?: RightsFocus;
  onBack: () => void;
}) {
  const preview = usePreview();
  const blocksQuery = useAccessBlocks();
  const teamsQuery = useTeams();
  const current = useMasterDraft();
  const [active, setActive] = useState<string | null>(null);

  // Страницу открыли без карточки (ссылкой, после перезапуска) — черновика
  // нет, и выставлять права некому.
  if (!current) return <RightsPlaceholder onBack={onBack} title="Черновик мастера закрыт" />;
  const blocks = blocksQuery.data;
  const teams = teamsQuery.data;
  if (!blocks || !teams) {
    const error = blocksQuery.isError || teamsQuery.isError;
    return (
      <RightsPlaceholder
        onBack={onBack}
        error={error}
        title={error ? "Права не загрузились" : undefined}
        onRetry={() => {
          void blocksQuery.refetch();
          void teamsQuery.refetch();
        }}
      />
    );
  }
  // Выбор пишется в сам черновик: `withLevel` кладёт календарный уровень
  // только в его календари, а выбрать можно только календарь с чипом.
  const draft = withLiveTeams(current.draft, liveIdsOf(teams));
  return (
    <MasterRightsView
      subtitle={draft.name.trim() || draft.email.trim() || undefined}
      onBack={onBack}
      blocks={blocks}
      teams={teams}
      teamIds={draft.teamIds}
      activeTeamId={focus?.kind === "calendar" ? focus.teamId : activeOf(active, draft.teamIds)}
      {...focusViewProps(focus, teams)}
      onSelectTeam={setActive}
      levelOf={visibleLevel(blocks, draft)}
      onPick={(block, level, teamId) =>
        updateMasterDraft((currentDraft) => withLevel(currentDraft, block, level, teamId))
      }
      area={rightsAreaOf(area)}
      onPreview={() =>
        preview({
          blocks,
          draft,
          name: draft.name,
          area: rightsAreaOf(area),
          calendarName:
            teams.find((team) => team.id === activeOf(active, draft.teamIds))?.name ?? null,
        })
      }
    />
  );
}

function InviteRights({
  invitationId,
  area,
  focus,
  onBack,
}: {
  invitationId: string;
  area?: string;
  focus?: RightsFocus;
  onBack: () => void;
}) {
  const toast = useToast();
  const preview = usePreview();
  const blocksQuery = useAccessBlocks();
  const teamsQuery = useTeams();
  const update = useUpdateMasterInvitation();
  const { query, row } = usePendingInvitation(invitationId, onBack);
  const [active, setActive] = useState<string | null>(null);

  const blocks = blocksQuery.data;
  const teams = teamsQuery.data;
  if (!row || !blocks || !teams) {
    const error = query.isError || blocksQuery.isError || teamsQuery.isError;
    return (
      <RightsPlaceholder
        onBack={onBack}
        error={error}
        title={error ? "Права не загрузились" : undefined}
        onRetry={() => {
          void query.refetch();
          void blocksQuery.refetch();
          void teamsQuery.refetch();
        }}
      />
    );
  }
  const draft = withLiveTeams(draftFromInvitation(row), liveIdsOf(teams));
  const cardFields = invitationCarriesCardFields(row);

  return (
    <MasterRightsView
      subtitle={draft.name.trim() || draft.email}
      onBack={onBack}
      blocks={blocks}
      teams={teams}
      teamIds={draft.teamIds}
      activeTeamId={focus?.kind === "calendar" ? focus.teamId : activeOf(active, draft.teamIds)}
      {...focusViewProps(focus, teams)}
      onSelectTeam={setActive}
      levelOf={visibleLevel(blocks, draft)}
      onPick={(block, level, teamId) => {
        const next = withLevel(draft, block, level, teamId);
        if (next === draft) return;
        // Приглашение уходит целиком; кэш «Ждут ответа» меняется сразу и
        // возвращается при отказе (`useUpdateMasterInvitation`). Должность и
        // цвет приглашения по карточке и диспетчера не шлём — сервер отказал
        // бы или молча стёр (`invitationCarriesCardFields`).
        const sent = cardFields ? next : { ...next, title: "", color: null };
        update.mutate(
          { invitationId: row.id, request: invitationRequest(sent, blocks, phoneToSave) },
          {
            onError: (error) => {
              if (!isInvitationGone(error)) toast(invitationRefusalText(error), "error");
            },
          },
        );
      }}
      area={rightsAreaOf(area)}
      // ПРИГЛАШЕНИЕ — САМЫЙ ПОЛЕЗНЫЙ МОМЕНТ ДЛЯ ЗЕРКАЛА: человек ещё не в
      // компании, и посмотреть, что он увидит, стоит ДО того, как позвали.
      // Кнопки здесь не было — три режима одной страницы разошлись.
      onPreview={() =>
        preview({
          blocks,
          draft,
          name: draft.name,
          area: rightsAreaOf(area),
          calendarName:
            teams.find((team) => team.id === activeOf(active, draft.teamIds))?.name ?? null,
        })
      }
    />
  );
}
