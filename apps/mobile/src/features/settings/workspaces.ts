import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/providers/SessionProvider";
import { switchTenant } from "./switch-tenant";
import { useTenant } from "./tenant";
import { USER_ROLES, type UserRole } from "./role-policy";

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

/** Чужой чип носит компанию в идентификаторе: пара (компания, календарь) —
 *  настоящий ключ, в базе у команд именно такой первичный ключ. Без компании
 *  два календаря с одинаковым id из разных компаний слиплись бы в один. */
const FOREIGN_PREFIX = "@";

export interface CalendarChip {
  id: string;
  name: string;
  color?: string | null;
  /** Чип чужой компании — рисуется обводкой, а не заливкой. Поле объявлено
   *  здесь, а не дописывается к объекту молча: лента его читает, и тип обязан
   *  об этом знать. */
  outline?: boolean;
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
  const tenant = useTenant();
  const switching = useSwitchWorkspace();
  // Имя активной компании нужно, чтобы поставить СВОИ чипы на их место в общем
  // порядке. Лента знает его сама; запасной путь — сама компания, на случай
  // когда в активной компании нет ни одного неархивного календаря и в ленте
  // её строки нет вовсе.
  const activeTenantName =
    myCalendars.find((c) => c.isActive)?.tenantName ?? tenant.data?.name ?? "";
  const [pendingId, setPendingId] = useState<string | null>(null);

  const foreign = myCalendars.filter((c) => !c.isActive);
  const ownChips: CalendarChip[] = opts.own.map((tm) => ({
    id: tm.id,
    name: tm.name,
    color: tm.color,
  }));

  // ПОРЯДОК РЯДА НЕ ЗАВИСИТ ОТ ТОГО, ГДЕ ЧЕЛОВЕК СЕЙЧАС.
  //
  // Владелец 2026-09-12: «как установлено — Y&D первая, вторая Команда 1 —
  // оно не должно прыгать вправо-влево». Раньше ряд начинался с календарей
  // АКТИВНОЙ компании, и переход переставлял чипы местами ровно в ту секунду,
  // когда человек на них смотрит: бывший чужой становился своим и уезжал в
  // начало. Место в ряду читается как «так установлено», а не как «я сейчас
  // здесь»; где он сейчас, говорит ЗАЛИВКА чипа.
  //
  // Компании идут по имени, внутри компании порядок прежний. Свои чипы
  // остаются из СВОЕГО источника: экран отдаёт ещё и архивные календари, за
  // которыми осталась работа, а серверный список архивные не возвращает вовсе
  // — пересортировать одну серверную выдачу значило бы молча потерять их.
  //
  // ЧУЖОЙ ЧИП — ДРУГОЙ ПРИРОДЫ, И ЭТО ВИДНО БЕЗ СЛОВ. В ряду два одинаковых с
  // виду чипа делают РАЗНОЕ: свой переключает разрез внутри компании, чужой
  // уводит в другую — другие счета, долги, прибыль. На календаре безобидно, на
  // деньгах человек тапнет «соседний», чтобы сравнить бригады, и увидит чужую
  // кассу. Подписи компании при этом НЕ БУДЕТ: «Giliuta · Команда 1» владелец
  // отверг сразу — «нельзя делать такую длинную, просто Команда 1».
  const byTenant = new Map<string, CalendarChip[]>();
  byTenant.set(activeTenantName, ownChips);
  for (const c of foreign) {
    const chips = byTenant.get(c.tenantName) ?? [];
    chips.push({
      id: `${FOREIGN_PREFIX}${c.tenantId}:${c.teamId}`,
      name: c.teamName,
      color: c.teamColor,
      outline: true,
    });
    byTenant.set(c.tenantName, chips);
  }
  const items: CalendarChip[] = foreign.length
    ? [...byTenant.entries()]
        .sort(([a], [b]) => a.localeCompare(b, "ru"))
        .flatMap(([, chips]) => chips)
    : ownChips;

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

  return { items, pick, pendingId };
}
