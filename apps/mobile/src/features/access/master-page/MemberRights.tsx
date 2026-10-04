import { useState } from "react";

import { useTeams } from "@/features/reference/queries";

import { levelOf as mapLevelOf, type AccessRefusal } from "../access-map";
import { useAccessBlocks, useCompanyMembers, useMemberAccess } from "../queries";
import { usePartnerManager } from "./use-partner-manager";
import { MasterRightsView, focusViewProps, type RightsFocus } from "./MasterRightsView";
import { previewAreaOf } from "./rights-focus";
import { memberRefusal, useMemberRightsWriter } from "./member-rights-writer";
import { MEMBER_REFUSAL_TEXT, draftFromMemberAccess, rightsAreaOf } from "./rights-rows";
import { RightsPlaceholder, activeOf, liveIdsOf, usePreview } from "./rights-page-shared";

// РЕЖИМ «ПРАВА СОТРУДНИКА» — ТРЕТИЙ ИЗ ТРЁХ (черновик, приглашение, человек).
//
// Отличается от двух других тем, что выбор уходит на сервер сразу: карта
// правится оптимистично, а отказ возвращает прежнюю (`useSetMemberAccess`).
// Вынесен из `MasterRightsPage`, когда файл перевалил за 400 строк.

export function MemberRights({
  userId,
  teamId,
  area,
  focus,
  onBack,
}: {
  userId: string;
  teamId: string | null;
  area?: string;
  /** Права одного календаря или компании (STORY-087). */
  focus?: RightsFocus;
  onBack: () => void;
}) {
  const blocksQuery = useAccessBlocks({ fresh: true });
  const accessQuery = useMemberAccess(userId);
  // Директор (04.10): себя и директоров не правит, «его глазами» — у владельца.
  const manager = usePartnerManager(userId, accessQuery.data);
  const membersQuery = useCompanyMembers();
  const preview = usePreview();
  const writer = useMemberRightsWriter(userId, blocksQuery.data);
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

  return (
    <MasterRightsView
      subtitle={subtitle}
      onBack={onBack}
      blocks={blocks}
      teams={teams}
      teamIds={visible}
      activeTeamId={focus?.kind === "calendar" ? focus.teamId : activeOf(active, visible)}
      {...focusViewProps(focus, teams)}
      onSelectTeam={setActive}
      levelOf={(block, pickTeam) => mapLevelOf(block, map, pickTeam ?? "")}
      // Неживой блок правится как остальные (владелец 15.09, миграция
      // 20260915110000): уровень хранится сейчас и заработает, когда блок
      // оживёт, — как на приглашении, иначе выданное там не снять после
      // приёма.
      busyKey={writer.busyKey}
      onPick={writer.pick}
      area={rightsAreaOf(area)}
      lockedAll={manager.readOnly ?? undefined}
      onPreview={manager.canPreview ? () =>
        preview({
          blocks,
          draft: draftFromMemberAccess(map, {
            name: subtitle ?? "",
            email: "",
            phone: "",
            title: "",
            color: null,
          }),
          name: subtitle ?? "",
          area: previewAreaOf(rightsAreaOf(area), focus),
          userId,
        })
      : undefined}
    />
  );
}
