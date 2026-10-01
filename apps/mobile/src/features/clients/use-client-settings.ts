import { useCallback } from "react";
import { useClientsCapabilities, useClientsScopeOrNull } from "./company-scope";
import {
  clientSettingLevels,
  type ClientSettingLevel,
  type ClientSettingLevels,
  type ClientSettingRow,
} from "./settings-levels";
import { useAccessMapOf } from "./sources";

// ЖИВОЙ СЛОЙ НАД `settings-levels.ts`: источник вкладки, роль в нём и карта
// прав ЕГО компании (01.10 — не только открытой в календаре: партнёр со
// своей компанией правит настройки команд работодателя из своей вкладки).
// Вне вкладки (Кабинет) источника нет — там, как и раньше, экран владельца,
// и всё открыто.

/** Положения строк шестерёнки для любой команды компании экрана. */
export function useClientSettingLevelsOf(): (teamId: string | null) => ClientSettingLevels {
  const caps = useClientsCapabilities();
  const scope = useClientsScopeOrNull();
  const map = useAccessMapOf(scope?.kind === "member" ? scope.tenantId : null);
  const own = caps.manage;
  const member = scope?.kind === "member";
  const role = scope?.role;
  return useCallback(
    (teamId: string | null) => clientSettingLevels({ own, member, role, map, teamId }),
    [own, member, role, map],
  );
}

/** Положение одной строки в одной команде. */
export function useClientSettingLevel(
  row: ClientSettingRow,
  teamId: string | null,
): ClientSettingLevel {
  return useClientSettingLevelsOf()(teamId)[row];
}
