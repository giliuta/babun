import type { AccessBlock, AccessLevel } from "@/session/access-map";
import type { MasterDraft } from "./master-draft";
import { offeredBlocks } from "./rights-copy";
import { roleLevel, type RolePreset } from "./role-presets";

/** Роль в черновике нового партнёра или в приглашении: права команды
 *  `teamId` и права аккаунта встают положениями роли. Хранится только
 *  отличное от умолчания — как «нет строки» в `member_access`; неживые блоки
 *  роль не трогает. */
export function draftWithRole(
  draft: MasterDraft,
  blocks: readonly AccessBlock[],
  role: RolePreset,
  teamId: string,
): MasterDraft {
  const team: Record<string, AccessLevel> = { ...(draft.calendarLevels[teamId] ?? {}) };
  const company: Record<string, AccessLevel> = { ...draft.companyLevels };
  for (const block of offeredBlocks(blocks)) {
    const target = block.scope === "calendar" ? team : company;
    const level = roleLevel(role, block);
    if (level === (block.levels[0] ?? "off")) delete target[block.key];
    else target[block.key] = level;
  }
  return {
    ...draft,
    companyLevels: company,
    calendarLevels: { ...draft.calendarLevels, [teamId]: team },
  };
}
