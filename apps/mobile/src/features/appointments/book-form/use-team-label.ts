import { useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from "react";
import type { Client } from "@babun/shared/local/clients";
import type { CalendarSettings } from "@babun/shared/local/calendar-settings";
import type { DayCityMap } from "@babun/shared/local/day-cities";
import {
  getCurrentCyprusTime,
  getCurrentTimeInZone,
} from "@babun/shared/common/utils/date-utils";
import {
  LABEL_FALLBACK_COLOR,
  resolveCalendarDayLabel,
} from "@/features/calendar/day-label";
import type { City, Team } from "@/features/reference/queries";
import type { useToast } from "@/components/ui/Toast";
import { formatYMD } from "@/features/appointments/helpers";

export interface TeamLabelInput {
  isEdit: boolean;
  allTeams: Team[];
  teams: Team[];
  teamId: string | null;
  client: Client | null;
  clientId: string | null;
  calendarSettings: CalendarSettings | undefined;
  dayCities: DayCityMap;
  teamCities: City[];
  date: string;
  dayLabelsOn: boolean;
  city: string | null;
  cityTouched: boolean;
  setCity: Dispatch<SetStateAction<string | null>>;
  toast: ReturnType<typeof useToast>;
}

/** The record's team (live or archived) and its label against the day's. */
export function useTeamLabel({
  isEdit,
  allTeams,
  teams,
  teamId,
  client,
  clientId,
  calendarSettings,
  dayCities,
  teamCities,
  date,
  dayLabelsOn,
  city,
  cityTouched,
  setCity,
  toast,
}: TeamLabelInput) {
  // ═══ МЕТКА КЛИЕНТА ПРОТИВ МЕТКИ ДНЯ ═══
  //
  // Владелец 2026-08-29: «вы записываете клиента, у которого уже была метка
  // такая-то — просто предупреждение».
  //
  // Метка у клиента появляется сама: рабочая запись в день с явной меткой
  // переносит её на клиента (`autoAssignClientLabel`, решение 2026-07-22).
  // То есть метка клиента — это «где его обслуживали в прошлый раз», а метка
  // дня — «где команда работает в этот день». Их расхождение и есть тот
  // случай, ради которого метки заводились: бригада едет в Лимассол, а в
  // день просунули клиента из Пафоса — крюк на полдня, о котором узнают
  // утром на выезде.
  //
  // ПРЕДУПРЕЖДЕНИЕ, А НЕ ЗАПРЕТ. Причин записать «не туда» полно: клиент сам
  // приедет, работа срочная, по пути. Продукт называет факт и уходит с
  // дороги.
  //
  // МОЛЧИТ, КОГДА МЕТКИ СОВПАЛИ: сообщать «вы записываете клиента туда же,
  // куда и всегда» — это шум, который научит не читать плашки вовсе.
  // ЗАПИСЬ АРХИВНОГО КАЛЕНДАРЯ — ТОЛЬКО ДЛЯ ПРОСМОТРА (владелец 2026-09-21:
  // «можно посмотреть запись… но оно всё в архиве, то есть уже удалено»). Её
  // открывают из карточки клиента; календаря в живом списке нет, поэтому имя,
  // цвет и часовой пояс берутся из архива. Ни сохранить, ни принять оплату в
  // архив нельзя — деньги архивного календаря в живых финансах не существуют.
  const archivedTeam = isEdit
    ? allTeams.find((tm) => tm.id === teamId && !tm.is_active) ?? null
    : null;
  const archivedRecord = archivedTeam !== null;
  const team = teams.find((tm) => tm.id === teamId) ?? archivedTeam;
  const clientLabel = (client?.city ?? "").trim();
  // МЕТКА ДНЯ — РОВНО ТА, ЧТО СТОИТ НА ДНЕ В КАЛЕНДАРЕ. Здесь звался
  // `resolveDayLabel` из shared: он знает только про ЯВНО поставленную метку
  // и ничего не знает про расписание меток по дням недели. Календарь печатал
  // на субботе «Лимассол» по расписанию, а запись на ту же субботу
  // показывала пустую «Метку» — два экрана говорили о разных метках одного
  // дня, ровно то, ради чего правило и переехало в `features/calendar`.
  const todayYmd = useMemo(() => {
    const timeZone = team?.timezone ?? calendarSettings?.timezone;
    return formatYMD(
      timeZone ? getCurrentTimeInZone(timeZone) : getCurrentCyprusTime(),
    );
  }, [team?.timezone, calendarSettings?.timezone]);
  const dayLabelResolved = useMemo(
    () =>
      resolveCalendarDayLabel({
        dayCities,
        cities: teamCities,
        teamId,
        dateYmd: date,
        todayYmd,
        fallbackColor: LABEL_FALLBACK_COLOR,
        off: !dayLabelsOn,
      }),
    [dayCities, teamCities, teamId, date, todayYmd, dayLabelsOn],
  );
  const dayLabel = dayLabelResolved?.name ?? null;
  // Новая запись надевает метку дня сама и меняет её вслед за днём и
  // командой — пока человек не выбрал метку руками.
  useEffect(() => {
    if (isEdit || cityTouched) return;
    setCity(dayLabel);
  }, [isEdit, cityTouched, dayLabel, setCity]);
  // ЧТО НА САМОМ ДЕЛЕ У ЭТОЙ РАБОТЫ: своя метка сильнее метки дня. Ею же
  // судится расхождение с меткой клиента — иначе продукт спорил бы сам с
  // собой: поставил записи «Пафос» под клиента, а плашка всё равно ругается
  // на «Лимассол» дня.
  const effectiveLabel = city ?? dayLabel;
  const labelClash = useMemo(
    () =>
      clientLabel !== "" && effectiveLabel !== null && effectiveLabel !== clientLabel
        ? { client: clientLabel, day: effectiveLabel }
        : null,
    [clientLabel, effectiveLabel],
  );
  // Показываем ОДИН раз на пару «клиент + день», а не на каждый рендер:
  // плашка, выезжающая от каждого касания формы, читается как поломка.
  const clashShown = useRef<string | null>(null);
  useEffect(() => {
    if (!labelClash || !clientId) {
      clashShown.current = null;
      return;
    }
    const key = `${clientId}|${date}|${labelClash.day}`;
    if (clashShown.current === key) return;
    clashShown.current = key;
    toast(
      `Клиент из «${labelClash.client}», а день — «${labelClash.day}»`,
      "warn",
    );
  }, [labelClash, clientId, date, toast]);
  const slotFallback = team?.default_slot_minutes ?? 30;
  return { archivedRecord, team, todayYmd, effectiveLabel, slotFallback };
}
