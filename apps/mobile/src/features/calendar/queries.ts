import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listAppointments as listAppointmentsCached } from "@babun/shared/sync/appointmentsCached";
import { READ_ONLY_VIEW_FIELD } from "@babun/shared/sync/replayer";
import {
  listDayExtras,
  setDayExtras,
} from "@babun/shared/db/repositories/day-extras";
import {
  getDayExtras,
  setDayExtrasFor,
  type DayExtra,
  type DayExtrasMap,
} from "@babun/shared/local/day-extras";
import type { Appointment } from "@babun/shared/local/appointments";
import type { Service } from "@babun/shared/local/services";
import { supabase } from "@/lib/supabase";
import { tenantBoundClient } from "@/lib/tenant-bound-client";
import { useTenantId } from "@/lib/tenant";
import { useAllServices } from "@/features/services/queries";
import { useDataRole } from "@/features/settings/tenant";
import { accessGate, moneyKey } from "@/features/access/my-access";
import { useMyAccess } from "@/features/access/queries";
import { listMasterAppointmentsSafePaged } from "./master-appointments";
import { useClientsScopeOrNull } from "@/features/clients/company-scope";
import {
  appointmentsQueryKey,
  dayExtrasQueryKey,
} from "@/lib/company-query-keys";

// PostgREST silently caps every response at 1000 rows (Supabase default
// max-rows), so an unordered, unlimited listAppointments truncates a busy
// tenant's calendar without any error.
//
// STORY-062 slice 5 — READS now go through the offline-aware SWR wrapper
// (appointmentsCached.listAppointments). The slice-4 blocker is closed: the
// wrapper stores the FULL domain Appointment and its background revalidate
// prunes server-deleted rows (cacheReplaceTenant) and, on a real change, fires
// `revalidated`, which the realtime bridge (SyncBridgeMount) turns into a
// react-query invalidate so pull-to-refresh and focus refetch settle on fresh
// data. Warm cache serves the last snapshot offline; a cold offline read
// raises a typed blocking error so an unknown calendar cannot look free.
// Writes already go through the wrapper.
//
// PAGING is preserved by threading the self-paging shim BELOW into the wrapper
// as its supabase client. `listAppointments` uses that client both for the
// cold-cache read and the background revalidate, so every server list still
// loops the 1000-row windows internally. The shim intercepts `from → select →
// eq` (the exact chain repoListAppointments builds — the wrapper calls the
// same repo under the hood) and throws on any other builder method so a
// query-shape drift fails loudly instead of mis-paging.
const APPT_PAGE_SIZE = 1000;

type AnyResult = { data: any[] | null; error: unknown };

// A client that resolves `from(t).select(cols).eq(col,val)` to ALL pages.
// The returned object is thenable so both `await client.from()...eq()` and
// `client.from()...eq().then()` (whatever the caller does) get the full set.
/** Шим постраничного чтения поверх ЛЮБОГО клиента: обычного или привязанного
 *  к чужой компании (`bind-tenant.ts`) — прогрев читает записи им же. */
export function pagingClient(base: typeof supabase = supabase): typeof supabase {
  const runAllPages = async (
    table: string,
    columns: string,
    column: string,
    value: string,
  ): Promise<AnyResult> => {
    const all: unknown[] = [];
    for (let offset = 0; ; offset += APPT_PAGE_SIZE) {
      const { data, error } = await ((base.from as any)(table)
        .select(columns)
        .eq(column, value)
        // date alone is not unique — without the id tiebreaker PostgREST
        // paging can skip / duplicate rows across pages.
        .order("date", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + APPT_PAGE_SIZE - 1) as PromiseLike<AnyResult>);
      if (error) return { data: null, error };
      const page = data ?? [];
      all.push(...page);
      if (page.length < APPT_PAGE_SIZE) break;
    }
    return { data: all as AnyResult["data"], error: null };
  };

  // Guard: any builder method the shim doesn't model (e.g. a future `.order`
  // / `.range` / `.maybeSingle` added to repoListAppointments) throws a clear
  // error instead of silently returning `undefined` — so a query-shape drift
  // fails loudly at the exact call, not as a downstream «x is not a function».
  const throwUnexpected = (method: string) => (): never => {
    throw new Error(
      `pagingClient: unexpected query method ".${method}" — the paging shim ` +
        `only models from→select→eq; update the shim if the read chain changed.`,
    );
  };

  return {
    // ВИД ТОЛЬКО ДЛЯ ЧТЕНИЯ: обёртка подталкивает выгрузку очереди тем
    // клиентом, что ей дали, а писать шиму нечем — выгрузка пойдёт клиентом
    // хоста (`READ_ONLY_VIEW_FIELD`, 03.10: правка записи падала «update is
    // not a function» и откатывалась).
    [READ_ONLY_VIEW_FIELD]: true,
    from: (table: string) => ({
      select: (columns: string) => ({
        // Thenable + explicit throw-guards for every builder method the shim
        // does NOT model. A repo read that appends `.order/.range/.limit/
        // .maybeSingle/.is` after `.eq` would otherwise hit `undefined()`.
        eq: (column: string, value: string) => ({
          then: (
            onFulfilled: ((value: AnyResult) => unknown) | null | undefined,
            onRejected: ((e: unknown) => unknown) | null | undefined,
          ) =>
            runAllPages(table, columns, column, value).then(
              onFulfilled ?? undefined,
              onRejected ?? undefined,
            ),
          order: throwUnexpected("order"),
          range: throwUnexpected("range"),
          limit: throwUnexpected("limit"),
          maybeSingle: throwUnexpected("maybeSingle"),
          single: throwUnexpected("single"),
          is: throwUnexpected("is"),
        }),
      }),
    }),
  } as unknown as typeof supabase;
}

// All tenant appointments (RLS-scoped), read via the offline-aware SWR wrapper
// and paged around the 1000-row cap by threading the shim above in as the
// wrapper's supabase client. Retained name/signature: useClientAppointments
// imports this.
//
// КЛИЕНТ ПРИВЯЗАН К КОМПАНИИ КЛЮЧА, А НЕ К КОМПАНИИ УСТРОЙСТВА. Обёртка
// отдаёт снимок SQLite и отпускает фоновое перечитывание, а шим читает
// страницы одну за другой — по 2–6 с каждую в очереди бесплатного плана.
// Глобальный клиент берёт заголовок на КАЖДЫЙ запрос: переход посреди чтения
// отправлял бы вторую страницу под другой компанией, сервер отвечал нулём
// строк, и `cacheReplaceTenant` стирал остаток записей этой компании с
// меткой «сервер сказал: пусто». Привязанный клиент несёт заголовок `tenantId`
// на всех страницах, в том числе у отпущенного перечитывания. Сам шим —
// вид только для чтения: подталкивание очереди выгрузки им сливается
// настоящим клиентом хоста (`writeClient` умолчаний реплеера).
export async function listAppointmentsPaged(
  tenantId: string,
): Promise<Appointment[]> {
  return listAppointmentsCached(pagingClient(tenantBoundClient(tenantId)), tenantId);
}

/** Ключ живёт в `lib/company-query-keys.ts`; реэкспорт для тех, кто уже
 *  импортирует его отсюда (`useClientAppointments`, `label-auto-assign`). */
export { appointmentsQueryKey };

// All tenant appointments (RLS-scoped) — shared cache key with the per-client
// hook (which adds a `select` filter on top of the same data).
// ЗАПИСИ ЧИТАЮТСЯ В КОМПАНИИ ЭКРАНА. В календаре это компания устройства, а
// на вкладке «Клиенты» — компания её источника (STORY-082): там список и
// статистика («последний визит», «команда», фильтр по команде) должны быть
// про ту же компанию, чьи клиенты в списке. Вне вкладки источника нет, и всё
// работает как раньше.
export function useAppointments() {
  const scope = useClientsScopeOrNull();
  const activeTenantId = useTenantId();
  const roleQuery = useDataRole();
  const tenantId = scope?.tenantId ?? activeTenantId;
  const role = scope ? scope.role : roleQuery.data;
  const ready = scope ? true : roleQuery.isSuccess && roleQuery.data != null;
  const guest = scope?.kind === "member" || scope?.kind === "record";
  return useQuery({
    queryKey: appointmentsQueryKey(tenantId, role),
    // Fail closed: no broad cached list is mounted before the membership role
    // is confirmed. Masters always bypass the SQLite/SWR wrapper.
    enabled: !!tenantId && ready && role != null,
    queryFn: () => {
      if (guest || role === "master") {
        return listMasterAppointmentsSafePaged(
          scope && !scope.isActive ? tenantBoundClient(tenantId as string) : supabase,
        );
      }
      if (role === "owner" || role === "dispatcher") {
        return listAppointmentsPaged(tenantId as string);
      }
      throw new Error("Нет доступа к календарю");
    },
  });
}

// Manual per-day income/expense line items, keyed "teamId:date" (shared
// DayExtrasMap shape). Feeds computeDayFinance in the day-finance footer.
export function useDayExtras() {
  const tenantId = useTenantId();
  const roleQuery = useDataRole();
  const role = roleQuery.data;
  // Ручные операции дня — деньги команды (этап 2 доступа): читает тот, кто
  // видит хотя бы одну сторону — доходы или расходы (срез 2а) — хотя бы в
  // одном календаре; какие строки ему придут, решает сервер (по стороне).
  const map = useMyAccess().data;
  const sees = (["income", "expense"] as const).some((side) => {
    const gate = accessGate({ role, map, blockKey: moneyKey(map, side), scope: "calendar" });
    return gate === "read" || gate === "write";
  });
  return useQuery({
    queryKey: dayExtrasQueryKey(tenantId, role),
    enabled: !!tenantId && roleQuery.isSuccess && sees,
    queryFn: () => listDayExtras(supabase, tenantId as string),
  });
}

// Замена всего списка ручных операций одной пары (team, date) — тот же
// shared-репозиторий, что и веб (setDayExtras: delete + reinsert).
// Оптимистично патчим карту в кэше, чтобы добавленная строка появилась
// в модалке и в футере без ожидания сервера; при ошибке откатываем
// ТОЛЬКО свой ключ (не всю карту — образец: useUpdateAppointment).
export function useSetDayExtras() {
  const tenantId = useTenantId();
  const role = useDataRole().data;
  const myAccess = useMyAccess().data;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      teamId,
      dateKey,
      extras,
    }: {
      teamId: string;
      dateKey: string;
      extras: DayExtra[];
    }) => {
      // Менять ручные операции может тот, кто пишет хотя бы одну сторону денег
      // в ЭТОМ календаре; сервер (`replace_day_extras`, срез 2а) пишет только
      // его стороны, а чужую строку пропускает лишь нетронутой.
      const writes = (["income", "expense"] as const).some(
        (side) =>
          accessGate({ role, map: myAccess, blockKey: moneyKey(myAccess, side), scope: "calendar", teamId }) ===
          "write",
      );
      if (!writes) {
        throw new Error("Менять доходы и расходы в этом календаре вам не открыто.");
      }
      return setDayExtras(supabase, tenantId as string, teamId, dateKey, extras);
    },
    onMutate: async ({ teamId, dateKey, extras }) => {
      const key = ["day-extras", tenantId, role ?? "role-pending"];
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<DayExtrasMap>(key);
      qc.setQueryData<DayExtrasMap>(key, (cur) =>
        setDayExtrasFor(cur ?? {}, teamId, dateKey, extras),
      );
      return { prevExtras: getDayExtras(previous ?? {}, teamId, dateKey) };
    },
    onError: (_err, { teamId, dateKey }, ctx) => {
      if (!ctx) return;
      qc.setQueryData<DayExtrasMap>(
        ["day-extras", tenantId, role ?? "role-pending"],
        (cur) => setDayExtrasFor(cur ?? {}, teamId, dateKey, ctx.prevExtras),
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["day-extras"] }),
  });
}

// Services in the runtime shape computeDayFinance expects (shared local
// Service — it only touches id + material_costs). DB rows carry the same
// shape with material_costs as jsonb; guard it in case of bad rows. Shared
// by the day-finance footer and the month money mini-list.
export function useFinanceServices(): Service[] {
  // Полный справочник: расход материалов уже состоявшейся записи не должен
  // обнуляться от того, что услугу убрали из прайса.
  const { data: services = [] } = useAllServices();
  return useMemo(
    () =>
      services.map((s) => ({
        ...s,
        material_costs: Array.isArray(s.material_costs) ? s.material_costs : [],
      })) as unknown as Service[],
    [services],
  );
}
