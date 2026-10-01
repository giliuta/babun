import { useCallback } from "react";
import { useMyAccess } from "@/features/access/queries";
import { useCurrentRole } from "@/features/settings/tenant";
import { useClientsCapabilities, useClientsScopeOrNull } from "./company-scope";
import {
  clientSettingLevels,
  type ClientSettingLevel,
  type ClientSettingLevels,
  type ClientSettingRow,
} from "./settings-levels";

// ЖИВОЙ СЛОЙ НАД `settings-levels.ts`: источник вкладки, роль и карта прав
// активной компании. Вне вкладки (Кабинет) источника нет — там, как и раньше,
// экран владельца, и всё открыто.

/** Положения строк шестерёнки для любой команды — лента спрашивает каждую. */
export function useClientSettingLevelsOf(): (teamId: string | null) => ClientSettingLevels {
  const caps = useClientsCapabilities();
  const scope = useClientsScopeOrNull();
  const role = useCurrentRole().data;
  const map = useMyAccess().data;
  const own = caps.manage;
  const activeMember = scope?.kind === "member" && scope.isActive;
  return useCallback(
    (teamId: string | null) => clientSettingLevels({ own, activeMember, role, map, teamId }),
    [own, activeMember, role, map],
  );
}

/** Положение одной строки в одной команде. */
export function useClientSettingLevel(
  row: ClientSettingRow,
  teamId: string | null,
): ClientSettingLevel {
  return useClientSettingLevelsOf()(teamId)[row];
}
