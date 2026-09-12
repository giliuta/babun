import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/providers/SessionProvider";
import { switchTenant } from "./switch-tenant";

// КАЛЕНДАРИ ЧЕЛОВЕКА ВО ВСЕХ ЕГО КОМПАНИЯХ.
//
// Владелец 2026-09-12: «устроился к кому-то — ему добавляют календарь
// компании, и у него два календаря: свой и рабочий».
//
// Прочитать это обычным запросом нельзя: `tenants` отдаёт строку компании
// только владельцу и только для АКТИВНОЙ компании, а свои членства человек
// видит без названий. Поэтому безопасная функция `list_my_calendars()` —
// всё от `auth.uid()`, наружу только имя компании, имя и цвет календаря,
// роль и права.

export interface MyCalendar {
  tenantId: string;
  tenantName: string;
  teamId: string;
  teamName: string;
  teamColor: string | null;
  role: string;
  grants: string[];
  /** Календарь активной компании — открывается без переключения. */
  isActive: boolean;
  /** Компания прошла онбординг. Знаем ЗАРАНЕЕ, чтобы при переходе не
   *  показывать гейт «Открываем компанию»: он выясняет ровно этот факт. */
  onboarded: boolean;
}

interface MyCalendarRow {
  tenant_id: string;
  tenant_name: string;
  team_id: string;
  team_name: string;
  team_color: string | null;
  role: string;
  grants: string[] | null;
  is_active: boolean;
  onboarded: boolean;
}

/** Сгенерированный `database.types.ts` отстаёт от базы и этой функции ещё не
 *  знает. Узкий тип вместо `any`: канон запрещает `any`, а делать вид, что
 *  функции нет, нельзя. Уйдёт, когда типы перегенерируют. */
type RpcWithMyCalendars = {
  rpc: (name: "list_my_calendars") => PromiseLike<{
    data: MyCalendarRow[] | null;
    error: { message: string } | null;
  }>;
};

function toCalendar(row: MyCalendarRow): MyCalendar {
  return {
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    teamId: row.team_id,
    teamName: row.team_name,
    teamColor: row.team_color,
    role: row.role,
    grants: row.grants ?? [],
    isActive: row.is_active,
    onboarded: row.onboarded,
  };
}

export const myCalendarsQueryKey = ["my-calendars"] as const;

export function useMyCalendars() {
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  return useQuery({
    // Ключ НЕ содержит активную компанию: список один и тот же по обе стороны
    // перехода, и переспрашивать его на каждом переключении незачем. Зато
    // содержит человека — чужой список после смены аккаунта не показывается.
    queryKey: [...myCalendarsQueryKey, userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async (): Promise<MyCalendar[]> => {
      const client = supabase as unknown as RpcWithMyCalendars;
      const { data, error } = await client.rpc("list_my_calendars");
      if (error) throw new Error(error.message);
      return (data ?? []).map(toCalendar);
    },
  });
}

export function useSwitchWorkspace() {
  return useMutation({
    networkMode: "always",
    mutationFn: (input: { tenantId: string; onboarded: boolean }) =>
      switchTenant(input.tenantId, input.onboarded),
  });
}

// ЛЕНТА КАЛЕНДАРЕЙ — ОДНО ТЕЛО НА ПРОДУКТ.
//
// Владелец 2026-09-12: «не кнопкой „другие“ — в ряд добавляется: Y&D, личный,
// ещё, ещё, и я уже выбираю; в финансах соответственно то же самое».
//
// Лент в продукте две — над календарём и над финансами, — и обе показывают
// один и тот же список. Держать в них две копии правил (что чужое, как
// склеен идентификатор, что делать по тапу) значит получить два разных
// поведения на одной неделе.

/** Чужой чип носит компанию в идентификаторе: пара (компания, календарь) —
 *  настоящий ключ, в базе у команд именно такой первичный ключ. Без компании
 *  два календаря с одинаковым id из разных компаний слиплись бы в один. */
const FOREIGN_PREFIX = "@";

export interface CalendarChip {
  id: string;
  name: string;
  color?: string | null;
}

export function useCalendarChips(opts: {
  /** Календари АКТИВНОЙ компании — как их знает экран. */
  own: readonly { id: string; name: string; color?: string | null }[];
  /** Выбран свой календарь: экран сам решает, что это значит. */
  onPickOwn: (teamId: string) => void;
  /** Переход не состоялся — человек остаётся там, где был, и знает почему. */
  onSwitchError: (message: string) => void;
}): {
  items: CalendarChip[];
  pick: (chipId: string) => void;
  /** Чип, в который человек уже тапнул, пока переход ещё идёт. Лента
   *  подсвечивает ЕГО, а не тот, что был: экран обязан отвечать на касание
   *  сразу, иначе пять секунд сети читаются как «не нажалось». */
  pendingId: string | null;
} {
  const { data: myCalendars = [] } = useMyCalendars();
  const switching = useSwitchWorkspace();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const foreign = myCalendars.filter((c) => !c.isActive);
  const items: CalendarChip[] = foreign.length
    ? [
        ...opts.own.map((tm) => ({ id: tm.id, name: tm.name, color: tm.color })),
        // ЧУЖОЙ ЧИП — ДРУГОЙ ПРИРОДЫ, И ЭТО ВИДНО БЕЗ СЛОВ. В ряду два
        // одинаковых с виду чипа делают РАЗНОЕ: свой переключает разрез внутри
        // компании, чужой уводит в другую — другие счета, долги, прибыль. На
        // календаре безобидно, на деньгах человек тапнет «соседний», чтобы
        // сравнить бригады, и увидит чужую кассу.
        //
        // Подписи компании здесь НЕ БУДЕТ: «Giliuta · Команда 1» владелец
        // отверг сразу — «нельзя делать такую длинную, просто Команда 1».
        // Отличие несёт форма чипа (обводка вместо заливки), а не текст.
        ...foreign.map((c) => ({
          id: `${FOREIGN_PREFIX}${c.tenantId}:${c.teamId}`,
          name: c.teamName,
          color: c.teamColor,
          outline: true,
        })),
      ]
    : opts.own.map((tm) => ({ id: tm.id, name: tm.name, color: tm.color }));

  const pick = (chipId: string) => {
    if (!chipId.startsWith(FOREIGN_PREFIX)) {
      opts.onPickOwn(chipId);
      return;
    }
    const separator = chipId.indexOf(":");
    const tenantId = chipId.slice(FOREIGN_PREFIX.length, separator);
    const teamId = chipId.slice(separator + 1);
    const target = foreign.find((c) => c.tenantId === tenantId);

    // Лента подсвечивает выбранный чип СРАЗУ, не дожидаясь сети. Сам переход —
    // две поездки на сервер (сменить компанию в токене и забрать новый токен),
    // это пять секунд, и убрать их нельзя. Убрать можно ожидание с глаз: тап
    // отвечает мгновенно, дальше экран показывает скелет своего календаря.
    setPendingId(chipId);
    switching.mutate(
      { tenantId, onboarded: target?.onboarded ?? false },
      {
        onSuccess: () => {
          opts.onPickOwn(teamId);
          setPendingId(null);
        },
        onError: (error) => {
          // Переход не состоялся — подсветка возвращается туда, где человек и
          // остался. Оставить её на чужом чипе значило бы соврать про то, где
          // он сейчас.
          setPendingId(null);
          opts.onSwitchError(
            error instanceof Error
              ? error.message
              : "Не удалось открыть календарь",
          );
        },
      },
    );
  };

  return { items, pick, pendingId };
}
