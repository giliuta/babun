import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/providers/SessionProvider";
import { useTenantId } from "@/lib/tenant";
import { switchTenant } from "./switch-tenant";
import { USER_ROLES, type UserRole } from "./role-policy";
import {
  composeCalendarChips,
  FOREIGN_PREFIX,
  type CalendarChip,
} from "./calendar-chips";

export type { CalendarChip } from "./calendar-chips";

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

/** Роль приезжает с сервера СТРОКОЙ, а в кэш прав кладётся типом. Незнакомую
 *  роль не пропускаем вовсе: пусть экран спросит сервер, чем поверит в право,
 *  которого продукт не знает. Сужение живёт здесь, на границе, а не в
 *  `switch-tenant.ts` — туда роль обязана приходить уже проверенной. */
function asUserRole(role: string): UserRole | undefined {
  return (USER_ROLES as readonly string[]).includes(role)
    ? (role as UserRole)
    : undefined;
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
    // Роль и факт онбординга едут ВМЕСТЕ с переходом, потому что оба уже
    // известны из ленты календарей. Без роли граница прав на той стороне
    // показывает второй полноэкранный спиннер поверх уже открытого экрана:
    // компания сменилась мгновенно, а `current_user_role` ещё летит.
    mutationFn: (input: {
      tenantId: string;
      onboarded: boolean;
      role?: UserRole;
    }) =>
      switchTenant(input.tenantId, {
        onboarded: input.onboarded,
        role: input.role,
      }),
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
  /** Список календарей ещё не доехал — то есть мы НЕ ЗНАЕМ, есть ли у человека
   *  другие календари. Экран обязан отличать это от «других нет»: лента —
   *  единственная дверь из компании, и показать «календаря нет, попросите
   *  владельца» без неё значит запереть человека на ровном месте. */
  loading: boolean;
} {
  const { data: myCalendars = [], isPending: calendarsPending } =
    useMyCalendars();
  const switching = useSwitchWorkspace();
  // СВОЁ И ЧУЖОЕ СЧИТАЕТСЯ ОТ КОМПАНИИ УСТРОЙСТВА, А НЕ ОТ ФЛАГА СЕРВЕРА.
  //
  // `isActive` из `list_my_calendars` — это `t.tenant_id = current_tenant_id()`
  // на момент ОТВЕТА. Сразу после тапа список ещё прежний: в нём «активна»
  // компания, откуда человек ушёл, а новая числится чужой. Итог в одном кадре
  // — свои календари новой компании приходят из экрана заливкой, они же из
  // старого списка обводкой как чужие, а календари покидаемой компании
  // исчезают вовсе. На экране: «Y&D» дважды, «Команды 1» нет.
  //
  // Компания устройства меняется в ТОМ ЖЕ кадре, что и тап, и сети не
  // требует; список компаний и их календарей от перехода не меняется вовсе —
  // устаревает только флаг. Поэтому состав ряда берётся от устройства, а флаг
  // сервера остаётся запасным путём на единственный случай, когда компания
  // устройства ещё не известна: пометить тогда чужими ВСЕ календари значило бы
  // задвоить свои.
  const activeTenantId = useTenantId();
  const isActiveCompany = (c: MyCalendar): boolean =>
    activeTenantId ? c.tenantId === activeTenantId : c.isActive;
  const [pendingId, setPendingId] = useState<string | null>(null);

  const foreign = myCalendars.filter((c) => !isActiveCompany(c));
  // Состав и порядок ряда — чистая функция в листе `calendar-chips.ts`: там
  // она проверяется тестом, а здесь, рядом с react-native и supabase, раннер
  // тестов её не поднимет.
  const items = composeCalendarChips({
    own: opts.own,
    myCalendars,
    activeTenantId,
  });

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

    // ЗАВЕРШЕНИЕ ВИСИТ НА ПРОМИСЕ, А НЕ НА ПОДПИСКЕ ЭКРАНА. Колбэки, переданные
    // в `mutate()`, react-query зовёт через наблюдателя мутации — а его
    // размонтирование экрана уносит с собой. Переход как раз и перетряхивает
    // дерево (чистка кэша, смена компании), поэтому здесь это не теория: не
    // доехавший `onSuccess` означает, что открылся НЕ ТОТ календарь, в который
    // тапнули, — компания сменилась, а разрез остался прежним. Промис
    // `mutateAsync` живёт сам по себе и доводит выбор до конца.
    void switching
      .mutateAsync({
        tenantId,
        onboarded: target?.onboarded ?? false,
        role: target ? asUserRole(target.role) : undefined,
      })
      .then(() => {
        opts.onPickOwn(teamId);
        setPendingId(null);
      })
      .catch((error: unknown) => {
        // Переход не состоялся — подсветка возвращается туда, где человек и
        // остался. Оставить её на чужом чипе значило бы соврать про то, где
        // он сейчас.
        setPendingId(null);
        opts.onSwitchError(
          error instanceof Error
            ? error.message
            : "Не удалось открыть календарь",
        );
      });
  };

  return { items, pick, pendingId, loading: calendarsPending };
}
