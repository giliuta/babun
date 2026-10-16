import { syncCalendarBilling } from "@/lib/sync-calendars";
import { useCallback } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { generateId } from "@babun/shared/local/masters";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { firstCalendarFromRpc } from "@/features/reference/first-calendar";
import { teamsQueryKey } from "@/lib/company-query-keys";
import { useDataRole, type UserRole } from "@/session/tenant";
import { useMirror } from "@/session/mirror-state";
import { operationalTeamJsonToTeam } from "@/features/settings/master-reference";
import { pickLiveTeams } from "../reference-select";
import { referenceKeys } from "../query-keys";
import { useReferenceCompany } from "./company";
import type { Team } from "./types";

// ─── Teams ───────────────────────────────────────────────────────────
// `includeInactive` — для резолва имён по историческим ссылкам
// (accounts.brigade_id может указывать на soft-deleted команду; список
// счетов обязан показать её имя, а не прочерк). Пикеры/фильтры зовут
// без опции и видят только активные.
/** Чтение команд ЧИСТОЙ функцией: клиент — параметром, чтобы прогрев чужой
 *  компании читал их клиентом, привязанным к ней. Хук ниже зовёт её обычным. */
export async function fetchTeams(
  client: typeof supabase,
  tenantId: string,
  role: UserRole,
  includeInactive: boolean,
): Promise<Team[]> {
  if (role === "dispatcher" || role === "master") {
    const { data, error } = await client.rpc("list_operational_teams_safe");
    if (error) throw new Error(error.message);
    const rows = (data ?? []).map(operationalTeamJsonToTeam);
    return includeInactive ? rows : rows.filter((row) => row.is_active);
  }
  if (role !== "owner") throw new Error("Нет доступа к календарям");
  let q = client.from("teams").select("*").eq("tenant_id", tenantId);
  if (!includeInactive) q = q.eq("is_active", true);
  // Позиция у новых календарей и меток — 0 у всех (создание её не пишет),
  // и порядок решала физическая раскладка таблицы: правка строки (имя, цвет,
  // часы) уносила её в конец, и лента команд переставлялась сама. Второй ключ — время создания: порядок стоит.
  const { data, error } = await q.order("position").order("created_at");
  if (error) throw new Error(error.message);
  return data;
}

export function useTeams(opts?: { includeInactive?: boolean }) {
  const { tenantId, role: companyRole, ready, client } = useReferenceCompany();
  const includeInactive = !!opts?.includeInactive;
  // ЗЕРКАЛО ПОКАЗЫВАЕТ ТОЛЬКО ЕГО КАЛЕНДАРИ. Список приходит по токену
  // ВЛАДЕЛЬЦА, то есть полный: в предпросмотре лента показывала команды, к
  // которым человек не прикреплён вовсе, — а
  // настоящему сотруднику сервер отдаёт только его.
  const mirror = useMirror();
  const attached =
    mirror && mirror.map.tenantId === tenantId
      ? new Set(mirror.map.attachedCalendars)
      : null;
  const select = useCallback(
    (rows: Team[]) => {
      const live = includeInactive ? rows : pickLiveTeams(rows);
      return attached ? live.filter((team) => attached.has(team.id)) : live;
    },
    // Набор прикреплений меняется вместе с режимом; строка — чтобы новый
    // Set каждого рендера не пересобирал `select` впустую.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [includeInactive, attached ? [...attached].sort().join(",") : null],
  );
  // ДАННЫЕ ЗЕРКАЛА ЧИТАЕТ ВЛАДЕЛЕЦ («права его, данные ваши»). Дверь команд
  // сотрудника (`list_operational_teams_safe`) по токену владельца отдаёт
  // пусто — в зеркале у партнёра не было ни одной команды, а с ними и
  // клиентов. Список берётся владельческий и режется по его
  // прикреплениям выше.
  const role: UserRole | null | undefined = attached ? "owner" : companyRole;
  return useQuery({
    // ОДИН ЗАПРОС НА ОБА ВАРИАНТА. Календарь зовёт хук и так, и
    // с архивом — это были два запроса за одной таблицей в каждой волне после
    // перехода. Читаем полный список, активные отбираются на устройстве тем же
    // условием, что стояло в запросе (`reference-select.ts`, с тестом).
    queryKey: teamsQueryKey(tenantId, role, true),
    enabled: !!tenantId && ready && role != null,
    queryFn: () =>
      fetchTeams(client, tenantId as string, role as UserRole, true),
    select,
  });
}

// Single-team read for the brigade hub. Dedicated by-id fetch (not a select
// off the list cache) so it resolves even for a soft-deleted team the active
// list filters out, and so the hub always sees the freshest jsonb after an
// edit. Keyed by id → its own cache entry, invalidated by the ["teams"] wipe.
export function useTeam(id: string | undefined) {
  const tenantId = useTenantId();
  const roleQuery = useDataRole();
  return useQuery({
    queryKey: referenceKeys.team(tenantId, roleQuery.data, id),
    enabled: !!tenantId && !!id && roleQuery.isSuccess && roleQuery.data === "owner",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .eq("id", id as string)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

/** ПЕРВЫЙ КАЛЕНДАРЬ — РЕШАЕТ БАЗА. Экран заводит «Личный» сам, когда
 *  список календарей пуст, — но пустым его однажды прочли без входа (истёк
 *  токен: RLS отдал 0 строк ответом 200), и у компании с тремя календарями
 *  появился второй «Личный». `create_first_calendar` под замком компании
 *  проверяет живые календари и, если они есть, ничего не создаёт: ответ —
 *  `null`, экран просто перечитывает список. */
export function useCreateFirstCalendar() {
  const qc = useQueryClient();
  return useMutation({
    networkMode: "always",
    mutationFn: async (input: { name: string; color?: string }): Promise<Team | null> => {
      // No colour is sent as an omitted argument: the SQL default is null.
      const { data, error } = await supabase.rpc("create_first_calendar", {
        p_id: generateId("team"),
        p_name: input.name,
        p_color: input.color || undefined,
      });
      if (error) throw new Error(error.message);
      return firstCalendarFromRpc<Team>(data);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: referenceKeys.teamAll() });
    },
    meta: { errorHandled: true },
  });
}

export function useCreateTeam() {
  const tenantId = useTenantId();
  const role = useDataRole().data;
  const qc = useQueryClient();
  return useMutation({
    // Без сети — отказ сразу, а не пауза: отложенное создание календаря
    // срабатывало, когда вернулась сеть и его уже никто не ждал.
    networkMode: "always",
    mutationFn: async (input: {
      name: string;
      color?: string;
    }) => {
      if (role !== "owner") {
        throw new Error("Создавать календари может только владелец.");
      }
      const { data, error } = await supabase
        .from("teams")
        .insert({
          id: generateId("team"),
          tenant_id: tenantId as string,
          name: input.name,
          color: input.color || null,
          // Календарные колонки НЕ засеваются: null = «как везде». Раньше
          // здесь прописывались окно 00:00–23:00, скролл 10:00 и строка
          // расписания 10:00–20:00 — а поскольку читатели резолвят как
          // `команда ?? общее` ((dashboard)/index.tsx), команды без override
          // просто не существовало, и ВСЕ общие часы были мертвы у каждого
          // тенанта. Выходных посев тоже не нёс: он писал только start/end,
          // без overrides, так что все семь дней и там были рабочими.
          payout_percentage: 30,
        })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: referenceKeys.teamAll() });
      // Новый календарь — в подписке со следующего платежа.
      syncCalendarBilling();
    },
    meta: { errorHandled: true }, // RefListScreen call sites alert themselves
  });
}
