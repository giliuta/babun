import { useMemo, useState } from "react";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ScopeChips } from "@/components/ui/ScopeChips";
import {
  ClientsScopeProvider,
  useClientsCapabilities,
  useClientsScopeOrNull,
} from "@/session/company-scope";
import type { ClientsScope } from "@/session/clients-company";
import { useAccessMaps, useClientsSources } from "@/features/clients/sources";
import { useGuestSources } from "@/features/clients/guest-sources";
import { anyClientSetting, clientSettingLevels } from "@/features/clients/settings-levels";
import { useClientsTeam } from "@/features/clients/team-pref";
import { ALL_TEAMS } from "@/features/clients/team-scope";
import { useMyAccess } from "@/session/access-queries";
import { useTeams } from "@/features/reference/queries";
import { useTenantId } from "@/lib/tenant";
import { SettingsBody } from "./SettingsBody";

// «Настройки клиентов» page: the team ribbon on top, the body of the picked
// team below (`SettingsBody`). The route `clients/settings.tsx` wraps it in
// the source gate.

export function ClientsSettingsScreen() {
  const activeTenantId = useTenantId();
  const routeScope = useClientsScopeOrNull();
  const caps = useClientsCapabilities();
  // У КАЖДОЙ КОМАНДЫ СВОИ НАСТРОЙКИ КЛИЕНТОВ (владелец 30.09), как у
  // настроек календаря: лента команд наверху, строки правят выбранную.
  // ЛЕНТА — СВОИ КОМАНДЫ И КОМАНДЫ РАБОТОДАТЕЛЕЙ (01.10): партнёр со своей
  // компанией видел здесь только её; теперь рядом стоят команды, где ему
  // открыли хоть одну строку «Настроек клиентов», — тем же чипом, что свои.
  // Всё под лентой читается и пишется в компании выбранной команды.
  const { data: ownTeams = [] } = useTeams();
  const { data: listTeam } = useClientsTeam(ownTeams[0]?.tenant_id ?? null);
  const sources = useClientsSources();
  const memberScopes = useMemo(
    () => sources.list.filter((source) => source.kind === "member"),
    [sources.list],
  );
  const guests = useGuestSources(memberScopes);
  const activeMap = useMyAccess().data;
  const foreignIds = useMemo(
    () => memberScopes.map((s) => s.tenantId).filter((id) => id !== activeTenantId),
    [memberScopes, activeTenantId],
  );
  const foreignMaps = useAccessMaps(foreignIds);
  const ribbon = useMemo(() => {
    const out: { id: string; name: string; color: string | null; scope: ClientsScope }[] = [];
    if (caps.manage && routeScope) {
      for (const tm of ownTeams) out.push({ id: tm.id, name: tm.name, color: tm.color, scope: routeScope });
    }
    for (const guest of guests.list) {
      const map =
        guest.scope.tenantId === activeTenantId ? activeMap : foreignMaps.get(guest.scope.tenantId);
      for (const tm of guest.teams) {
        const levels = clientSettingLevels({
          own: false,
          member: true,
          role: guest.scope.role,
          map,
          teamId: tm.id,
        });
        if (anyClientSetting(levels)) {
          out.push({ id: tm.id, name: tm.name, color: tm.color ?? null, scope: guest.scope });
        }
      }
    }
    return out;
  }, [caps.manage, routeScope, ownTeams, guests.list, activeTenantId, activeMap, foreignMaps]);
  const [pickedTeam, setPickedTeam] = useState<string | null>(null);
  const entry =
    ribbon.find((tm) => tm.id === pickedTeam) ??
    (listTeam && listTeam !== ALL_TEAMS ? ribbon.find((tm) => tm.id === listTeam) : undefined) ??
    ribbon[0] ??
    null;

  return (
    <Screen>
      <ScreenHeader
        title="Настройки клиентов"
        // Шов несёт лента команд; без неё линию берёт шапка (как в
        // настройках календаря).
        seam={!entry}
      />
      {entry ? (
        <ScopeChips
          items={ribbon.map((tm) => ({ id: tm.id, name: tm.name, color: tm.color }))}
          activeId={entry.id}
          onSelect={setPickedTeam}
        />
      ) : null}
      {entry ? (
        // Компания выбранной команды — источник тела: хуки настроек читают и
        // пишут её, а подстраницы уносят её в адресе.
        <ClientsScopeProvider scope={entry.scope}>
          <SettingsBody
            key={entry.id}
            teamId={entry.id}
            tenantParam={entry.scope.tenantId !== routeScope?.tenantId ? entry.scope.tenantId : null}
          />
        </ClientsScopeProvider>
      ) : (
        // Строк не открыли ни одной: страница остаётся собой, а тело
        // говорит одной строкой — без подписи и без кнопки (канон пустых
        // состояний, LOCKED 2026-08-27).
        <EmptyState fill title="Настроек пока нет" />
      )}
    </Screen>
  );
}
