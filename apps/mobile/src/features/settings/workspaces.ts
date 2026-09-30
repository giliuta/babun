import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BOUND_TENANT_FIELD } from "@babun/shared/sync/replayer";
import { useMirror } from "@/features/access/mirror/mirror-state";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/providers/SessionProvider";
import { useTenantId } from "@/lib/tenant";
import { switchTenant } from "./switch-tenant";
import { myCalendarsQueryKey } from "./my-calendars-key";
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

// Ключ живёт листом (`my-calendars-key.ts`): его читает переход, а ключ
// отсюда замкнул бы круг импортов `workspaces` ↔ `switch-tenant`.
export { myCalendarsQueryKey };

/** Лента календарей человека ЧИСТОЙ функцией — её же берёт прогрев других
 *  компаний, чтобы узнать, какие они и кем там человек.
 *
 *  ТОЛЬКО ОБЫЧНЫМ КЛИЕНТОМ, И ЭТО ПРОВЕРЯЕТСЯ, А НЕ ОБЕЩАЕТСЯ. Почти вся
 *  лента от компании не зависит: роль, права, имена, `onboarded` берутся по
 *  членству человека. Кроме одного поля — `is_active` считается как
 *  `tenant_id = current_tenant_id()`, то есть от ЗАГОЛОВКА запроса. Возьми
 *  ленту клиентом, привязанным к компании B, и положи под общий ключ
 *  `["my-calendars", userId]` (у него нет компании — это кэш экрана) — и в
 *  кадре, когда компания устройства ещё не известна, ряд отметит «активной»
 *  B при человеке в A: тот самый дубль чипа, от которого ушли в B3. Нашла
 *  сессия 005, 2026-09-13. */
export async function fetchMyCalendars(
  client: typeof supabase,
): Promise<MyCalendar[]> {
  if (BOUND_TENANT_FIELD in (client as object)) {
    throw new Error(
      "fetchMyCalendars: лента календарей читается только обычным клиентом — " +
        "флаг «активная» в ней считается от заголовка компании.",
    );
  }
  const rpc = client as unknown as RpcWithMyCalendars;
  const { data, error } = await rpc.rpc("list_my_calendars");
  if (error) throw new Error(error.message);
  return (data ?? []).map(toCalendar);
}

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
    queryFn: () => fetchMyCalendars(supabase),
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
      /** Календарь, в который тапнули, — ложится в выбор ЦЕЛЕВОЙ компании. */
      viewTeamId?: string;
    }) =>
      switchTenant(input.tenantId, {
        onboarded: input.onboarded,
        role: input.role,
        viewTeamId: input.viewTeamId,
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

  // ВЫБОР ЭКРАНА ПОСЛЕ ПЕРЕХОДА — СВЕЖИМ ЭКРАНОМ, А НЕ ЗАМЫКАНИЕМ ТАПА.
  //
  // Раньше `onPickOwn(teamId)` звался в `.then` перехода — с `opts` того
  // рендера, в котором тапнули. Его замыкание знает компанию, из которой
  // УХОДИМ: календарь записывал выбранный календарь новой компании в выбор
  // покидаемой, и возврат туда открывал не свой календарь. Звать его до
  // перехода — та же ошибка.
  //
  // Теперь сам выбор кладёт переход в настройку ЦЕЛЕВОЙ компании
  // (`viewTeamId`), а экранное (снять режим переноса, разрез финансов) делает
  // `onPickOwn` из ПЕРВОГО рендера уже в новой компании — эффектом ниже.
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const arrivalRef = useRef<{ tenantId: string; teamId: string } | null>(null);
  useEffect(() => {
    const arrival = arrivalRef.current;
    if (!arrival || arrival.tenantId !== activeTenantId) return;
    arrivalRef.current = null;
    optsRef.current.onPickOwn(arrival.teamId);
  }, [activeTenantId]);

  // ЧУЖИХ КОМПАНИЙ В ЗЕРКАЛЕ НЕТ. Лента строится по календарям ВОШЕДШЕГО, а у
  // владельца их несколько компаний: в предпросмотре сотрудника одной фирмы
  // была видна вторая — и дверь в неё. Сотрудник видит только свою.
  const inMirror = useMirror() !== null;
  const calendars = inMirror ? myCalendars.filter(isActiveCompany) : myCalendars;

  const foreign = calendars.filter((c) => !isActiveCompany(c));
  // Состав и порядок ряда — чистая функция в листе `calendar-chips.ts`: там
  // она проверяется тестом, а здесь, рядом с react-native и supabase, раннер
  // тестов её не поднимет.
  const items = composeCalendarChips({
    own: opts.own,
    myCalendars: calendars,
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
    // Экранная часть выбора ждёт первого рендера в новой компании — разбор
    // над `arrivalRef`.
    arrivalRef.current = { tenantId, teamId };
    void switching
      .mutateAsync({
        tenantId,
        onboarded: target?.onboarded ?? false,
        role: target ? asUserRole(target.role) : undefined,
        viewTeamId: teamId,
      })
      .then(() => {
        setPendingId(null);
      })
      .catch((error: unknown) => {
        // Переход не состоялся — подсветка возвращается туда, где человек и
        // остался. Оставить её на чужом чипе значило бы соврать про то, где
        // он сейчас.
        arrivalRef.current = null;
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
