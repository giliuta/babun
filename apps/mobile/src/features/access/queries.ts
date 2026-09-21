import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PostgrestError } from "@supabase/supabase-js";

import {
  accessBlocksQueryKey,
  calendarMembersQueryKey,
  memberAccessQueryKey,
  myAccessQueryKey,
} from "@/lib/company-query-keys";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { useMirror } from "./mirror/mirror-state";

import {
  parseAccessBlocks,
  parseMemberAccessMap,
  type AccessChange,
  type MemberAccessMap,
} from "./access-map";
import {
  FINANCE_BLOCK_KEYS,
  isFinanceDataKey,
  lostAccess,
  recordLevelsChanged,
} from "./my-access";

// ПРАВА СОТРУДНИКА — ДОРОГА К СЕРВЕРУ ПО «КОНТРАКТУ v1.1» (STORY-081).
//
// Чтение людей и их прав и запись прав доступны только владельцу активной
// компании: сервер отвечает 42501 с `hint = 'access:not_owner'`. Своих
// вставок прав здесь нет и быть не может — единственный писатель
// `set_member_access` на сервере (сессия 006).

export interface CalendarMember {
  userId: string;
  role: string;
  name: string;
  email: string;
  /** До этапа SMS номер лежит в профиле и не подтверждён. */
  phone: string | null;
  phoneVerified: boolean;
  calendars: string[];
  joinedAt: string;
}

/** Ошибка запроса с `hint` контракта — по нему экран называет причину. */
export class AccessRequestError extends Error {
  readonly hint: string | null;
  readonly code: string | null;

  constructor(error: PostgrestError) {
    super(error.message);
    this.hint = error.hint || null;
    this.code = error.code || null;
  }
}

const BAD_MEMBERS = "Сервер вернул некорректный список сотрудников";

function parseMembers(value: unknown): CalendarMember[] {
  if (!Array.isArray(value)) throw new Error(BAD_MEMBERS);
  return value.map((item): CalendarMember => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error(BAD_MEMBERS);
    }
    const row = item as Record<string, unknown>;
    const calendars = row.calendars ?? [];
    if (
      typeof row.user_id !== "string" ||
      typeof row.role !== "string" ||
      typeof row.name !== "string" ||
      typeof row.email !== "string" ||
      !(row.phone == null || typeof row.phone === "string") ||
      typeof row.phone_verified !== "boolean" ||
      !Array.isArray(calendars) ||
      !calendars.every((id) => typeof id === "string") ||
      typeof row.joined_at !== "string"
    ) {
      throw new Error(BAD_MEMBERS);
    }
    return {
      userId: row.user_id,
      role: row.role,
      name: row.name,
      email: row.email,
      phone: row.phone ?? null,
      phoneVerified: row.phone_verified,
      calendars,
      joinedAt: row.joined_at,
    };
  });
}

/** Реестр блоков — общий для всех компаний, меняют его только миграции. */
export function useAccessBlocks() {
  return useQuery({
    queryKey: accessBlocksQueryKey(),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("access_blocks")
        .select("key, area, scope, levels, title_ru, owner_only, live, position")
        .order("position");
      if (error) throw new AccessRequestError(error);
      return parseAccessBlocks(data ?? []);
    },
  });
}

/** Люди, прикреплённые к календарю (все уровни, в том числе «Скрыт»). */
export function useCalendarMembers(teamId: string | undefined) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: calendarMembersQueryKey(tenantId, teamId ?? null),
    enabled: !!tenantId && !!teamId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_members", {
        p_team_id: teamId as string,
      });
      if (error) throw new AccessRequestError(error);
      return parseMembers(data);
    },
  });
}

/** Карта прав одного сотрудника глазами владельца. */
export function useMemberAccess(userId: string | undefined) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: memberAccessQueryKey(tenantId, userId ?? null),
    enabled: !!tenantId && !!userId,
    queryFn: async (): Promise<MemberAccessMap> => {
      const { data, error } = await supabase.rpc("list_member_access", {
        p_user_id: userId as string,
      });
      if (error) throw new AccessRequestError(error);
      return parseMemberAccessMap(data);
    },
  });
}

/** Страховочный опрос своей карты. Главная дорога — сигнал `access_changed`
 *  (владелец 14.09: «подписка, не опрос»); опрос ловит только пропущенный
 *  сигнал, поэтому редкий и не мешает очереди после перехода. */
const MY_ACCESS_BACKSTOP_MS = 5 * 60_000;

/** СВОИ ПРАВА человека в активной компании (этап 2): по ним экраны решают,
 *  скрыт блок, смотрит человек или меняет (`my-access.ts`). Карта приходит
 *  без уровней неживых блоков — сервер их ещё не проверяет. Смену прав
 *  приносит сигнал `access_changed` (`AppProviders` → `AccessSignalsMount`). */
export function useMyAccess() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  // ЗЕРКАЛО ОТВЕЧАЕТ ЗА ВСЕХ СРАЗУ. Пока владелец смотрит «его глазами»,
  // карта прав — его, и каждый экран, который спрашивает `accessGate`,
  // показывает то, что увидит этот человек. Запрос при этом не отменяется:
  // выход из режима возвращает свои права мгновенно, без похода в сеть.
  const mirror = useMirror();
  const query = useQuery({
    queryKey: myAccessQueryKey(tenantId),
    enabled: !!tenantId,
    networkMode: "always",
    refetchInterval: MY_ACCESS_BACKSTOP_MS,
    refetchIntervalInBackground: false,
    queryFn: async (): Promise<MemberAccessMap> => {
      const { data, error } = await supabase.rpc("my_access_map");
      if (error) throw new AccessRequestError(error);
      const next = parseMemberAccessMap(data);
      // ЗАБРАЛИ ДОСТУП К ДЕНЬГАМ — ОНИ УХОДЯТ С ТЕЛЕФОНА СРАЗУ (план доступа:
      // «понижение стирает данные блока»). Иначе закрытая вкладка ещё показала
      // бы прежние суммы из памяти, пока экран не сходит в сеть.
      const before = qc.getQueryData<MemberAccessMap>(myAccessQueryKey(tenantId));
      if (tenantId && lostAccess(before, next, FINANCE_BLOCK_KEYS)) {
        qc.removeQueries({ predicate: (query) => isFinanceDataKey(query.queryKey, tenantId) });
      }
      // Строки записей несут маску прежних прав — перечитать (без `await`:
      // волна запросов не должна держать карту прав).
      if (tenantId && recordLevelsChanged(before, next)) {
        void qc.invalidateQueries({ queryKey: ["appointments", tenantId] });
      }
      return next;
    },
  });
  // Компанию сверяет сам `useMirror`: зеркало действует только в той, для
  // которой собрано.
  return mirror ? { ...query, data: mirror.map } : query;
}

/** Переключил — применилось: сервер возвращает новую карту, она и ложится в
 *  кэш, без второго чтения. */
// КАЛЕНДАРИ СОТРУДНИКА ПРАВЯТСЯ ИЗ ПРИЛОЖЕНИЯ (владелец 20.09: «хочу полное
// редактирование правил для мастера»).
//
// Функция `set_member_calendars` жила на сервере с 14.09, но приложение её не
// звало ни из одного экрана: карточка сотрудника показывала календари
// строками и не давала ни прикрепить, ни открепить. Это ломало и права:
// уровни ставятся В КАЛЕНДАРЕ, и человека, которого не к чему прикрепить,
// нельзя было настроить вовсе.
//
// Ответ сервера — та же карта прав, что у `set_member_access`: прикрепление
// меняет и её (уровни в откреплённом календаре не считаются), поэтому кладём
// ответ в тот же ключ.
export function useSetMemberCalendars(userId: string) {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (teamIds: readonly string[]) => {
      const { data, error } = await supabase.rpc("set_member_calendars", {
        p_user_id: userId,
        p_team_ids: [...teamIds],
      });
      if (error) throw new AccessRequestError(error);
      return parseMemberAccessMap(data);
    },
    onSuccess: (next) => {
      qc.setQueryData(memberAccessQueryKey(tenantId, userId), next);
    },
  });
}

export function useSetMemberAccess(userId: string) {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (changes: readonly AccessChange[]) => {
      const { data, error } = await supabase.rpc("set_member_access", {
        p_user_id: userId,
        p_changes: changes.map((c) => ({
          block: c.block,
          team_id: c.team_id,
          level: c.level,
        })),
      });
      if (error) throw new AccessRequestError(error);
      return parseMemberAccessMap(data);
    },
    onSuccess: (next) => {
      qc.setQueryData(memberAccessQueryKey(tenantId, userId), next);
    },
  });
}
