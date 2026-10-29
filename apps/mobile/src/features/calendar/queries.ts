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
import { READ_RPCS } from "@/lib/write-requests";
import { tenantBoundClient } from "@/lib/tenant-bound-client";
import { useTenantId } from "@/lib/tenant";
import { useAllServices } from "@/features/services/queries";
import { useDataRole } from "@/session/tenant";
import { accessGate, moneyKey } from "@/session/my-access";
import { useMyAccess } from "@/session/access-queries";
import { listMasterAppointmentsSafePaged } from "./master-appointments";
import { withQueuedMemberOps } from "@/lib/member-queue/runtime";
import { useClientsScopeOrNull } from "@/session/company-scope";
import {
  appointmentsQueryKey,
  dayExtrasQueryKey,
} from "@/lib/company-query-keys";

// STORY-062 slice 5 — READS go through the offline-aware SWR wrapper
// (appointmentsCached.listAppointments). The wrapper stores the FULL domain
// Appointment and its background revalidate prunes server-deleted rows
// (cacheReplaceTenant) and, on a real change, fires `revalidated`, which the
// realtime bridge (SyncBridgeMount) turns into a react-query invalidate so
// pull-to-refresh and focus refetch settle on fresh data. Warm cache serves
// the last snapshot offline; a cold offline read raises a typed blocking
// error so an unknown calendar cannot look free.
//
// PAGING around PostgREST's silent 1000-row cap lives in the repository
// itself (`listAppointments` in packages/shared/src/db/repositories/
// appointments.ts) — every caller, cached or not, gets the whole list.

/** ВИД ТОЛЬКО ДЛЯ ЧТЕНИЯ поверх ЛЮБОГО клиента: обычного или привязанного к
 *  чужой компании (`bind-tenant.ts`). Обёртка кэша подталкивает выгрузку
 *  очереди тем клиентом, что ей дали; вид объявляет себя полем
 *  `READ_ONLY_VIEW_FIELD`, и выгрузка идёт клиентом хоста (иначе правка
 *  записи падала «update is not a function» и откатывалась). `select`
 *  отдаётся настоящему билдеру целиком — фильтры, порядок и страницы
 *  репозитория работают как есть; записи у вида нет.
 *
 *  `rpc` — ТОЛЬКО ФУНКЦИИ ЧТЕНИЯ (`READ_RPCS`). Сверка записей дельтой зовёт
 *  отпечаток месяцев (`appointment_month_digest`); без `rpc` у вида вызов
 *  падал TypeError, и сверка молча уходила в полное чтение (замер на QA-5
 *  28.10). Функция записи видом не зовётся — отказ, а не тихий вызов. */
export function readOnlyClient(base: typeof supabase = supabase): typeof supabase {
  return {
    [READ_ONLY_VIEW_FIELD]: true,
    from: (table: Parameters<typeof base.from>[0]) => ({
      select: (columns?: string) => base.from(table).select(columns),
    }),
    rpc: (name: string, args?: Record<string, unknown>) =>
      READ_RPCS.has(name)
        ? (base.rpc as unknown as (n: string, a?: Record<string, unknown>) => unknown).call(base, name, args)
        : Promise.resolve({ data: null, error: { message: `read-only view: ${name} is not a read`, code: "READ_ONLY" } }),
  } as unknown as typeof supabase;
}

// All tenant appointments (RLS-scoped), read via the offline-aware SWR wrapper
// through the read-only view above. Retained name/signature:
// useClientAppointments imports this.
//
// КЛИЕНТ ПРИВЯЗАН К КОМПАНИИ КЛЮЧА, А НЕ К КОМПАНИИ УСТРОЙСТВА. Обёртка
// отдаёт снимок SQLite и отпускает фоновое перечитывание, а репозиторий читает
// страницы одну за другой — по 2–6 с каждую в очереди бесплатного плана.
// Глобальный клиент берёт заголовок на КАЖДЫЙ запрос: переход посреди чтения
// отправлял бы вторую страницу под другой компанией, сервер отвечал нулём
// строк, и `cacheReplaceTenant` стирал остаток записей этой компании с
// меткой «сервер сказал: пусто». Привязанный клиент несёт заголовок `tenantId`
// на всех страницах, в том числе у отпущенного перечитывания. Поверх него —
// вид только для чтения: подталкивание очереди выгрузки им сливается
// настоящим клиентом хоста (`writeClient` умолчаний реплеера).
export async function listAppointmentsPaged(
  tenantId: string,
): Promise<Appointment[]> {
  return listAppointmentsCached(readOnlyClient(tenantBoundClient(tenantId)), tenantId);
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
    // БЕЗ СЕТИ ЧТЕНИЕ ВСЁ РАВНО ИДЁТ. По умолчанию react-query
    // офлайн не зовёт `queryFn` вовсе — и обёртка кэша, которая как раз и
    // решает, что показать без сети (копию с устройства или честное «копии
    // нет»), не запускалась: компания, открытая без сети, рисовала пустую
    // неделю. `offlineFirst` зовёт её один раз; сетевой путь мастера без
    // копии встаёт на паузу, и экран говорит «недоступен офлайн».
    networkMode: "offlineFirst",
    queryFn: async () => {
      if (guest || role === "master") {
        const list = await listMasterAppointmentsSafePaged(
          scope && !scope.isActive ? tenantBoundClient(tenantId as string) : supabase,
        );
        // Свои правки, ещё ждущие сети, — поверх ответа сервера: иначе
        // перечитка до отправки вернула бы запись назад (`lib/member-queue`).
        return scope ? list : withQueuedMemberOps(list, tenantId);
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
