import type { Href } from "expo-router";
import { useTenantId } from "@/lib/tenant";
import { useTeams } from "@/features/reference/queries";
import { can } from "@/features/settings/role-policy";
import { useCurrentRole } from "@/features/settings/tenant";
import { useClientsScopeOrNull } from "./company-scope";
import { useInClientsTab, useReferenceHref } from "./reference-href";
import { clientSettingsDoor } from "./settings-door";
import { useClientSettingLevelsOf } from "./use-client-settings";

// ЖИВОЙ СЛОЙ НАД `settings-door.ts`: компания набора — та же, из которой его
// читает лист (`useScopeCompany` в `team-design.ts`): источник экрана, вне
// вкладки — открытая в календаре.

/** Шестерёнка листа «Связаться» / «Добавить» (`ways`) или «Маршрут»
 *  (`maps`): адрес подстраницы с командой и компанией, `null` — двери нет. */
export function useClientSettingsDoor(row: "ways" | "maps", teamId: string | null): Href | null {
  const refs = useReferenceHref();
  const inClientsTab = useInClientsTab();
  const scope = useClientsScopeOrNull();
  const activeTenantId = useTenantId();
  // Роль календаря — та, что пускает на общий адрес (`RoleCapabilityBoundary`);
  // в зеркале — его, а не владельца.
  const viewRole = useCurrentRole().data;
  const level = useClientSettingLevelsOf()(teamId)[row];
  // Команды компании набора (`useTeams` читает источник экрана). Архивная
  // команда клиента — тоже своя.
  const { data: teams } = useTeams({ includeInactive: true });
  const door = clientSettingsDoor({
    pathname: row === "ways" ? refs.channels : refs.maps,
    teamId,
    tenantId: scope?.tenantId ?? activeTenantId,
    level,
    owner: (scope ? scope.role : viewRole) === "owner",
    member: scope?.kind === "member",
    teamKnown: !teamId || (teams ?? []).some((tm) => tm.id === teamId),
    sharedRoute: !inClientsTab,
    operatesClients: can(viewRole, "operate-clients"),
  });
  return door as Href | null;
}
