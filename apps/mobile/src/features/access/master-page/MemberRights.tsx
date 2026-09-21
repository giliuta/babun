import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useToast } from "@/components/ui/Toast";
import { useTeams } from "@/features/reference/queries";
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
import { memberRefusal } from "./MasterMemberCard";
import { MasterRightsView } from "./MasterRightsView";
import {
  MEMBER_REFUSAL_TEXT,
  draftFromMemberAccess,
  levelChanges,
  rightsAreaOf,
  withMemberChanges,
} from "./rights-rows";
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
  const preview = usePreview();
  const setAccess = useSetMemberAccess(userId);
  const teamsQuery = useTeams();
  const [active, setActive] = useState<string | null>(teamId);
  /** Какая строка сейчас уезжает на сервер — она одна и пригашена. */
  const [saving, setSaving] = useState<string | null>(null);

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
    // когда блок оживёт (`levelChanges`).
    const changes = levelChanges(blocks, block, level, pickTeam);
    if (!changes) return;
    setSaving(block.key);
    const key = memberAccessQueryKey(tenantId, userId);
    const previous = qc.getQueryData<MemberAccessMap>(key);
    if (previous) qc.setQueryData(key, withMemberChanges(previous, blocks, changes));
    setAccess.mutate(changes, {
      onError: (error) => {
        if (previous) qc.setQueryData(key, previous);
        toast(MEMBER_REFUSAL_TEXT[memberRefusal(error)], "error");
      },
      onSettled: () => setSaving(null),
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
      // приёма.
      busyKey={setAccess.isPending ? saving : null}
      onPick={pick}
      area={rightsAreaOf(area)}
      onPreview={() =>
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
          area: rightsAreaOf(area),
          calendarName: teams.find((team) => team.id === activeOf(active, visible))?.name ?? null,
        })
      }
    />
  );
}
