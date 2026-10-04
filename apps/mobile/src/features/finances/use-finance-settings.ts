import { useCallback } from "react";
import { useMyAccess } from "@/features/access/queries";
import { useCurrentRole } from "@/features/settings/tenant";
import {
  financeSettingLevels,
  type FinanceSettingLevel,
  type FinanceSettingLevels,
  type FinanceSettingRow,
} from "./settings-levels";

// ЖИВОЙ СЛОЙ НАД `settings-levels.ts`: роль и карта прав открытой компании.
// Финансы живут в компании календаря — источник один, в отличие от вкладки
// «Клиенты» с её несколькими базами.

/** Положения строк шестерёнки «Финансов» для любой команды компании. */
export function useFinanceSettingLevelsOf(): (teamId: string | null) => FinanceSettingLevels {
  const role = useCurrentRole().data;
  const map = useMyAccess().data;
  return useCallback(
    (teamId: string | null) => financeSettingLevels({ role, map, teamId }),
    [role, map],
  );
}

/** Положение одной строки в одной команде. */
export function useFinanceSettingLevel(
  row: FinanceSettingRow,
  teamId: string | null,
): FinanceSettingLevel {
  return useFinanceSettingLevelsOf()(teamId)[row];
}
