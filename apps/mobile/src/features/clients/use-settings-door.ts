import type { Href } from "expo-router";
import { useTenantId } from "@/lib/tenant";
import { useTeams } from "@/features/reference/queries";
import { useCurrentRole } from "@/features/settings/tenant";
import { useClientsScopeOrNull } from "./company-scope";
import { useReferenceHref } from "./reference-href";
import { clientSettingsDoor } from "./settings-door";
import { useClientSettingLevelsOf } from "./use-client-settings";

// ЖИВОЙ СЛОЙ НАД `settings-door.ts`: компания набора — та же, из которой его
// читает лист (`useScopeCompany` в `team-design.ts`): источник экрана, вне
// вкладки — открытая в календаре.

/** Шестерёнка листа «Связаться» / «Добавить» (`ways`), «Маршрут» (`maps`),
 *  «Тег» (`tags`) или «Источник» (`sources`): адрес подстраницы с командой и
 *  компанией, `null` — двери нет (чужая команда, скрытая строка). */
export function useClientSettingsDoor(
  row: "ways" | "maps" | "tags" | "sources",
  teamId: string | null,
): Href | null {
  const refs = useReferenceHref();
  const scope = useClientsScopeOrNull();
  const activeTenantId = useTenantId();
  // Вне вкладки источника нет: владелец ли — по роли календаря (в зеркале —
  // его, а не владельца). Общий адрес над табами стоит на тех же воротах
  // строки, что вкладочный (`settings-door.ts`), — своей проверки роли нет.
  const viewRole = useCurrentRole().data;
  const level = useClientSettingLevelsOf()(teamId)[row];
  // Команды компании набора (`useTeams` читает источник экрана). Архивная
  // команда клиента — тоже своя.
  const { data: teams } = useTeams({ includeInactive: true });
  const door = clientSettingsDoor({
    pathname: { ways: refs.channels, maps: refs.maps, tags: refs.tags, sources: refs.sources }[row],
    teamId,
    tenantId: scope?.tenantId ?? activeTenantId,
    level,
    owner: (scope ? scope.role : viewRole) === "owner",
    member: scope?.kind === "member",
    teamKnown: !teamId || (teams ?? []).some((tm) => tm.id === teamId),
  });
  return door as Href | null;
}
