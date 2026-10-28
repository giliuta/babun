import { levelOf as mapLevelOf, type AccessBlock, type MemberAccessMap } from "@/session/access-map";
import { useStepAllowed } from "@/session/use-partner-manager";

import { TeamRoleRow } from "../rights-ui/TeamRoleRow";
import { useMemberRightsWriter } from "./member-rights-writer";
import { roleChanges } from "./role-presets";

// РОЛЬ ПАРТНЁРА В КОМАНДЕ — ТЕМ ЖЕ ПУТЁМ ЗАПИСИ, ЧТО И СТРОКИ ПРАВ: одна
// пачка `set_member_access` с оптимистичной картой и откатом при отказе.

export function MemberTeamRole({
  userId,
  blocks,
  map,
  teamId,
  teamName,
  locked,
}: {
  userId: string;
  blocks: readonly AccessBlock[];
  map: MemberAccessMap;
  teamId: string;
  teamName: string;
  locked: boolean;
}) {
  const writer = useMemberRightsWriter(userId, blocks);
  const allows = useStepAllowed();
  const levelOf = (block: AccessBlock, pickTeam: string | null) => mapLevelOf(block, map, pickTeam ?? "");
  return (
    <TeamRoleRow
      blocks={blocks}
      levelOf={levelOf}
      teamId={teamId}
      teamName={teamName}
      locked={locked || writer.pending}
      stepAllowed={allows}
      onApply={(role, part) => {
        const changes = roleChanges(blocks, role, teamId, levelOf, part);
        if (changes) {
          writer.applyBatch(
            changes,
            part === "account"
              ? `Права аккаунта — как у роли «${role.title}»`
              : `Роль «${role.title}» — права выставлены`,
          );
        }
      }}
    />
  );
}
