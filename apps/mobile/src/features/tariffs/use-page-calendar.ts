import { useLocalSearchParams } from "expo-router";
import { readTenantPref } from "@/lib/tenant-prefs";
import { useTenantId } from "@/lib/tenant";
import { useTeams } from "@/features/reference/queries";

/** Календарь страницы тарифа: `?team=` из шестерёнки → открытый в самом
 *  календаре (тот же ключ, что у настроек календаря) → первый. Возврат из
 *  Stripe на сайт без параметра приходит туда же, откуда уходил. */
export function usePageCalendar() {
  const params = useLocalSearchParams<{ team?: string }>();
  const tenantId = useTenantId();
  const { data: teams = [], isLoading } = useTeams({ display: true });
  const persisted = tenantId
    ? readTenantPref<{ teamId?: string | null }>("calendar.view", tenantId)?.teamId
    : undefined;
  const id = params.team ?? persisted ?? teams[0]?.id;
  return { team: teams.find((x) => x.id === id) ?? teams[0] ?? null, loading: isLoading };
}
