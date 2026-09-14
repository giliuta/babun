import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PostgrestError } from "@supabase/supabase-js";

import {
  accessBlocksQueryKey,
  calendarMembersQueryKey,
  memberAccessQueryKey,
} from "@/lib/company-query-keys";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";

import {
  parseAccessBlocks,
  parseMemberAccessMap,
  type AccessChange,
  type MemberAccessMap,
} from "./access-map";

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

/** Переключил — применилось: сервер возвращает новую карту, она и ложится в
 *  кэш, без второго чтения. */
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
