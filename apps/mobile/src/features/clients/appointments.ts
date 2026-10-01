import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Appointment } from "@babun/shared/local/appointments";
import {
  appointmentsQueryKey,
  listAppointmentsPaged,
} from "@/features/calendar/queries";
import { listMasterAppointmentsSafePaged } from "@/features/calendar/master-appointments";
// РОЛЬ ЗДЕСЬ — СВОЯ (`useDataRole`), А НЕ ЗЕРКАЛЬНАЯ. Она входит в КЛЮЧ
// запроса и в форму чтения: на зеркальной роли каждый вход и выход из
// режима «его глазами» менял бы ключ, гнал холодную волну запросов, а строки
// владельца ложились бы под ключ «master» — тот самый, который потом возьмёт
// настоящий мастер на этом устройстве. Показ решает `useCurrentRole`.
import { useDataRole } from "@/features/settings/tenant";
import { useTenantId } from "@/lib/tenant";
import { tenantBoundClient } from "@/lib/tenant-bound-client";
import { useClientsScopeOrNull } from "./company-scope";
import { withClientHistory } from "./member-history";
import { useMemberClientHistory } from "./use-member-history";
import { useClient } from "./queries";

// Appointments for a single client — TanStack Query on top of the shared
// Supabase repository (port-as-is). The repo has no per-client list helper,
// so we fetch the tenant's appointments (RLS-scoped) and filter to this
// client in `select`. The list query is cached per-tenant, so opening
// several client cards reuses one network round-trip.
//
// KNOWN DIVERGENCE vs web: buildStatsMap on the web also name-matches
// legacy seed rows with client_id=null (name baked into `comment`). Here we
// deliberately pass ONLY strict client_id matches: the card blocks
// (Visits / Objects / Finance) render every row they receive, so letting
// null-id rows through would require duplicating that name matching at
// this layer. Live Supabase bookings always carry client_id; tenants with
// unmigrated legacy seed data may show fewer visits/LTV than the web list.
// ЗАПИСИ КЛИЕНТА ЧИТАЮТСЯ В ЕГО КОМПАНИИ. Карточка на вкладке «Клиенты»
// открывается в компании своей строки (STORY-082): своя — привязанным
// клиентом, компания-работодатель — безопасным списком мастера её же
// клиентом. Вне вкладки источника нет, и всё как раньше — активная компания.
export function useClientAppointments(clientId: string) {
  const scope = useClientsScopeOrNull();
  const activeTenantId = useTenantId();
  const roleQuery = useDataRole();
  const tenantId = scope?.tenantId ?? activeTenantId;
  const role = scope ? scope.role : roleQuery.data;
  const ready = scope ? true : roleQuery.isSuccess && roleQuery.data != null;
  const guest = scope?.kind === "member" || scope?.kind === "record";
  // Stable `select` identity — an inline arrow would make TanStack re-run
  // the tenant-wide filter on every render of every consumer.
  const select = useCallback(
    (all: Appointment[]) => all.filter((a) => a.client_id === clientId),
    [clientId],
  );
  // «ИСТОРИЯ ЗАПИСЕЙ» (01.10): у сотрудника календарь открывает клиента записи
  // только около записи, а прошлые визиты клиента приходят дверью сервера
  // по праву «История записей» (`member-history.ts`). Строка клиента — для
  // маски в «его глазами».
  const client = useClient(clientId).data;
  const history = useMemberClientHistory(scope, client ? [client] : undefined);
  const query = useQuery({
    queryKey: appointmentsQueryKey(tenantId, role),
    enabled: !!tenantId && !!clientId && ready && role != null,
    queryFn: () => {
      // В чужой компании записи видны ровно те, что открыты человеку, —
      // безопасным списком её же клиентом.
      if (guest || role === "master") {
        return listMasterAppointmentsSafePaged(
          scope && !scope.isActive ? tenantBoundClient(tenantId as string) : undefined,
        );
      }
      if (role === "owner" || role === "dispatcher") {
        return listAppointmentsPaged(tenantId as string);
      }
      throw new Error("Нет доступа к календарю");
    },
    select,
  });
  const own = useMemo(() => history.filter((row) => row.client_id === clientId), [history, clientId]);
  const data = useMemo(
    () => (query.data || own.length > 0 ? withClientHistory(query.data ?? [], own) : undefined),
    [query.data, own],
  );
  // Визиты, которых нет в его календаре: страница записи их не откроет —
  // строка истории для них без двери.
  const historyOnly = useMemo(() => {
    const inCalendar = new Set((query.data ?? []).map((row) => row.id));
    return new Set(own.filter((row) => !inCalendar.has(row.id)).map((row) => row.id));
  }, [query.data, own]);
  return { ...query, data, historyOnly };
}
