import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { useToast } from "@/components/ui/Toast";
import { phoneToSave } from "@/features/profile/profile";
import { useTeams, type Team } from "@/features/reference/queries";
import { memberAccessQueryKey } from "@/lib/company-query-keys";
import { useTenantId } from "@/lib/tenant";

import {
  levelOf as mapLevelOf,
  type AccessBlock,
  type AccessLevel,
  type AccessRefusal,
  type MemberAccessMap,
} from "../access-map";
import {
  useAccessBlocks,
  useCalendarMembers,
  useMemberAccess,
  useSetMemberAccess,
} from "../queries";
import { updateMasterDraft, useMasterDraft } from "./draft-store";
import { useUpdateMasterInvitation } from "./invitation-api";
import { invitationRefusalText, isInvitationGone } from "./invitation-contract";
import { usePendingInvitation } from "./MasterInviteCard";
import { memberRefusal } from "./MasterMemberCard";
import { MasterRightsView } from "./MasterRightsView";
import {
  draftFromInvitation,
  draftLevel,
  invitationCarriesCardFields,
  invitationRequest,
  withLevel,
  withLiveTeams,
} from "./master-draft";
import {
  MEMBER_REFUSAL_TEXT,
  memberLevelChanges,
  rightsAreaOf,
  withMemberChanges,
} from "./rights-rows";

// «ПРАВА» ВНУТРИ КАРТОЧКИ МАСТЕРА — ТРИ ИСТОЧНИКА, ОДНА СТРАНИЦА. Что куда
// ложится при выборе положения:
//   • draft  — в черновик (`draft-store`), уйдёт с «Пригласить»;
//   • invite — в приглашение (`update_invitation`), сразу, с откатом при отказе;
//   • member — в права сотрудника (`set_member_access`), сразу, с откатом.

export type MasterRightsPageProps =
  | { mode: "draft"; area?: string; onBack: () => void }
  | { mode: "invite"; invitationId: string; area?: string; onBack: () => void }
  | { mode: "member"; userId: string; teamId: string | null; area?: string; onBack: () => void };

export function MasterRightsPage(props: MasterRightsPageProps) {
  switch (props.mode) {
    case "invite":
      return (
        <InviteRights invitationId={props.invitationId} area={props.area} onBack={props.onBack} />
      );
    case "member":
      return (
        <MemberRights
          userId={props.userId}
          teamId={props.teamId}
          area={props.area}
          onBack={props.onBack}
        />
      );
    default:
      return <DraftRights area={props.area} onBack={props.onBack} />;
  }
}

/** Страница, которой пока нечего показать: едет, отказ или черновика нет. */
function RightsPlaceholder({
  subtitle,
  onBack,
  error,
  title,
  onRetry,
}: {
  subtitle?: string;
  onBack: () => void;
  error?: boolean;
  title?: string;
  onRetry?: () => void;
}) {
  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Права" subtitle={subtitle} onBack={onBack} />
      {error ? (
        <EmptyState
          fill
          state="error"
          title={title}
          action={onRetry ? { label: "Повторить", onPress: onRetry } : undefined}
        />
      ) : title ? (
        <EmptyState fill title={title} />
      ) : (
        <EmptyState fill state="loading" />
      )}
    </Screen>
  );
}

const activeOf = (active: string | null, teamIds: readonly string[]) =>
  active && teamIds.includes(active) ? active : (teamIds[0] ?? null);

/** Календари с чипом — активные. Только они выбираются, считаются и уходят:
 *  архивный календарь правился бы без подписи, а сервер молча снял бы правку.
 *  Поэтому страница ждёт список календарей — пустой снял бы все. */
const liveIdsOf = (teams: readonly Team[]) => new Set(teams.map((team) => team.id));

function DraftRights({ area, onBack }: { area?: string; onBack: () => void }) {
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
      activeTeamId={activeOf(active, draft.teamIds)}
      onSelectTeam={setActive}
      levelOf={(block, teamId) => draftLevel(block, draft, teamId)}
      canEdit={() => true}
      onPick={(block, level, teamId) =>
        updateMasterDraft((currentDraft) => withLevel(currentDraft, block, level, teamId))
      }
      area={rightsAreaOf(area)}
    />
  );
}

function InviteRights({
  invitationId,
  area,
  onBack,
}: {
  invitationId: string;
  area?: string;
  onBack: () => void;
}) {
  const toast = useToast();
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
      activeTeamId={activeOf(active, draft.teamIds)}
      onSelectTeam={setActive}
      levelOf={(block, teamId) => draftLevel(block, draft, teamId)}
      canEdit={() => true}
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
    />
  );
}

function MemberRights({
  userId,
  teamId,
  area,
  onBack,
}: {
  userId: string;
  teamId: string | null;
  area?: string;
  onBack: () => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const tenantId = useTenantId();
  const blocksQuery = useAccessBlocks();
  const accessQuery = useMemberAccess(userId);
  const membersQuery = useCalendarMembers(teamId ?? undefined);
  const setAccess = useSetMemberAccess(userId);
  const teamsQuery = useTeams();
  const [active, setActive] = useState<string | null>(teamId);

  const subtitle = membersQuery.data?.find((member) => member.userId === userId)?.name;
  const failure = blocksQuery.error ?? accessQuery.error;
  const blocks = blocksQuery.data;
  const map = accessQuery.data;
  const teams = teamsQuery.data;
  if (failure || teamsQuery.isError || !blocks || !map || !teams) {
    const refusal: AccessRefusal | null = failure
      ? memberRefusal(failure)
      : teamsQuery.isError
        ? "other"
        : null;
    return (
      <RightsPlaceholder
        subtitle={subtitle}
        onBack={onBack}
        error={refusal !== null}
        title={
          refusal === null
            ? undefined
            : refusal === "other"
              ? "Не удалось загрузить права"
              : MEMBER_REFUSAL_TEXT[refusal]
        }
        onRetry={() => {
          void blocksQuery.refetch();
          void accessQuery.refetch();
          void teamsQuery.refetch();
        }}
      />
    );
  }

  // Календарь из адреса — только если у него есть чип (`activeOf` ниже).
  const liveIds = liveIdsOf(teams);
  const visible = map.attachedCalendars.filter((id) => liveIds.has(id));

  const pick = (block: AccessBlock, level: AccessLevel, pickTeam: string | null) => {
    // Две записи не делят один снимок карты: откат второй вернул бы первую.
    if (setAccess.isPending) return;
    // Сбрасываются ВСЕ зависимые, и неживые: их уровень хранится и заработает,
    // когда блок оживёт (`memberLevelChanges`).
    const changes = memberLevelChanges(blocks, block, level, pickTeam);
    if (!changes) return;
    const key = memberAccessQueryKey(tenantId, userId);
    const previous = qc.getQueryData<MemberAccessMap>(key);
    if (previous) qc.setQueryData(key, withMemberChanges(previous, blocks, changes));
    setAccess.mutate(changes, {
      onError: (error) => {
        if (previous) qc.setQueryData(key, previous);
        toast(MEMBER_REFUSAL_TEXT[memberRefusal(error)], "error");
      },
    });
  };

  return (
    <MasterRightsView
      subtitle={subtitle}
      onBack={onBack}
      blocks={blocks}
      teams={teams}
      teamIds={visible}
      activeTeamId={activeOf(active, visible)}
      onSelectTeam={setActive}
      levelOf={(block, pickTeam) => mapLevelOf(block, map, pickTeam ?? "")}
      // Неживой блок правится как остальные (владелец 15.09, миграция
      // 20260915110000): уровень хранится сейчас и заработает, когда блок
      // оживёт, — как на приглашении, иначе выданное там не снять после
      // приёма. Пока запись идёт, новый выбор не принимаем, но строки не
      // гасим — оптимистичное значение уже на месте.
      canEdit={() => true}
      busy={setAccess.isPending}
      onPick={pick}
      area={rightsAreaOf(area)}
    />
  );
}
