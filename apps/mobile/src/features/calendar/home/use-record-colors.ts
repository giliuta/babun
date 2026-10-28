import { useCallback, useMemo } from "react";
import type { Appointment } from "@babun/shared/local/appointments";
import {
  useAutoColorRule,
  useBookingBlocks,
  useCancelledColor,
  useFallbackColor,
  usePaidColor,
  usePrepaidColor,
  useSituationPalette,
  type SituationPalette,
} from "@/features/appointments/booking-prefs";
import {
  COLOR_SITUATIONS,
  appointmentSituation,
  autoBaseColor,
  fullyPaid,
  partlyPaid,
  recordFilledFor,
  resolveRecordColor,
  serviceBaseColor,
  type ColorSituation,
} from "@/features/appointments/record-color";
import { useCities } from "@/features/reference/queries";
import { useDayCities, useSetDayCity } from "@/features/reference/day-cities";
import {
  LABEL_FALLBACK_COLOR,
  resolveCalendarDayLabel,
  type DayLabel,
} from "@/features/calendar/day-label";
import { resolveOffDayLabel } from "@/features/calendar/appointment-label";
import { isOverdue } from "@/features/calendar/overdue";
import type { CalendarClock } from "./use-calendar-clock";
import type { CalendarRights } from "./use-calendar-rights";
import type { CalendarScope } from "./use-calendar-scope";
import type { CalendarSources } from "./use-calendar-sources";
import type { RecordNaming } from "./use-record-naming";

type UseRecordColorsDeps =
  Pick<CalendarScope, "activeTeamId" | "activeTeam">
  & Pick<CalendarRights, "dayLabelsOn" | "paymentHiddenFor">
  & Pick<CalendarClock, "todayYmd" | "nowMinutes">
  & Pick<RecordNaming, "teamColor" | "serviceColorById">
  & Pick<CalendarSources, "t">;

/** Day labels and record colours of the open calendar: the label of a
 *  date, the colour rule, the "what is missing" situations. */
export function useRecordColors(deps: UseRecordColorsDeps) {
  const {
    activeTeamId, dayLabelsOn, todayYmd, teamColor, serviceColorById, paymentHiddenFor,
    nowMinutes, activeTeam, t,
  } = deps;
  // ─── Метки дней (web parity: city pill в шапке дня) ─────────────────
  // МЕТКИ АКТИВНОГО КАЛЕНДАРЯ, а не всего тенанта. Метка
  // принадлежит команде, и у каждой своя копия: без фильтра пикер дня
  // показывал «Лимассол» столько раз, сколько в компании команд.
  const autoColorRule = useAutoColorRule(activeTeamId);
  // ПАЛИТРА СТАБИЛЬНОЙ ССЫЛКОЙ. Хук собирает новый объект на каждый рендер,
  // а палитра — зависимость резолверов цвета сетки (`teamColorFor`,
  // `situationFor`, `holeByDay`): новая ссылка роняла memo Недели, Дня и всех
  // колонок на каждом флаге запроса, тосте и тике минуты. Ключ memo — сами
  // три цвета: строки сравниваются значением.
  const paletteRaw = useSituationPalette(activeTeamId);
  const situationPalette = useMemo<SituationPalette>(
    () => ({
      unpaid: paletteRaw.unpaid,
      noObject: paletteRaw.noObject,
    }),
    [paletteRaw.unpaid, paletteRaw.noObject],
  );
  const fallbackColor = useFallbackColor(activeTeamId);
  // Часы цвета «долга» — пятиминутками: прошедшая сегодня запись краснеет
  // вскоре после конца, а резолвер цвета (зависимость memo всей сетки) не
  // пересоздаётся каждую минуту.
  const colorMinutes = Math.floor(nowMinutes / 5) * 5;
  // Подсветка есть только у включённого блока (убрали объект — подсветка уходит;
  // убрали оплату — тоже; запись считается заполненной).
  const bookingBlocks = useBookingBlocks(activeTeamId);
  const activeSituations = useMemo<ColorSituation[]>(
    () =>
      COLOR_SITUATIONS.map((s) => s.id).filter((id) =>
        id === "noObject"
          ? bookingBlocks.includes("object")
          : bookingBlocks.includes("payment"),
      ),
    [bookingBlocks],
  );
  // ОТМЕНА И ОПЛАТА (настройка «Цвет записи»). Оплата красит, пока у команды
  // включён блок «Оплата»: выключили — её цвет уходит вместе с ним, как
  // «долг».
  const cancelledColor = useCancelledColor(activeTeamId);
  const paymentOn = bookingBlocks.includes("payment");
  const paidColor = usePaidColor(activeTeamId);
  const prepaidColor = usePrepaidColor(activeTeamId);
  const citiesQuery = useCities({ teamId: activeTeamId });
  const dayCitiesQuery = useDayCities();
  const cities = useMemo(() => citiesQuery.data ?? [], [citiesQuery.data]);
  const dayCities = useMemo(
    () => dayCitiesQuery.data ?? {},
    [dayCitiesQuery.data],
  );
  const setDayCityMut = useSetDayCity();
  // МЕТКА ДНЯ — ТОЛЬКО ЯВНАЯ: поставить её можно исключительно выбором по датам.
  //
  // Фолбэка на `team.default_city` нет: «одна метка на все дни сразу» — это
  // невидимая настройка, которая красила бы календарь из другого экрана: день
  // выглядел бы помеченным, хотя на нём никто ничего не ставил, и снять это
  // можно было бы только найдя звезду в справочнике.
  // ПРАВИЛО «КАКАЯ МЕТКА У ДНЯ» ЖИВЁТ В `features/calendar/day-label`: форма записи обязана
  // показать в шапке ТУ ЖЕ метку, что стоит на дне в календаре. Вторая копия
  // разошлась бы на первой правке, и два экрана заговорили бы о
  // разных метках одного дня. Порядок ступеней и закон «прошлое не
  // переписывается настройкой» покрыты тестами.
  const labelFor = useCallback(
    (dateYmd: string): DayLabel | null =>
      resolveCalendarDayLabel({
        dayCities,
        cities,
        teamId: activeTeamId,
        dateYmd,
        todayYmd,
        fallbackColor: LABEL_FALLBACK_COLOR,
        off: !dayLabelsOn,
      }),
    [activeTeamId, dayCities, cities, todayYmd, dayLabelsOn],
  );

  // ЦВЕТ ЗАПИСИ В АВТОМАТИЧЕСКОМ РЕЖИМЕ — ПО ПРАВИЛУ ИЗ НАСТРОЙКИ (Кабинет →
  // «Запись»). Форма записи спрашивает то же правило:
  // иначе один и тот же выезд был бы одного цвета в форме и другого в сетке.
  // «Цвет метки» падает на цвет команды, когда метки нет ни у записи, ни у
  // дня: блок без цвета хуже блока «не той» окраски.
  const teamColorFor = useCallback(
    (a: Appointment) => {
      // Цвет команды — общая последняя ступень для всех трёх правил: блок без
      // цвета хуже блока «не той» окраски.
      const labelName = (a.city ?? "").trim() || labelFor(a.date)?.name;
      const base = autoBaseColor(autoColorRule, {
        team: a.team_id ? teamColor.get(a.team_id) : null,
        label: labelName
          ? cities.find((c) => c.name === labelName)?.color
          : null,
        service: serviceBaseColor(a, (id) => serviceColorById.get(id)),
      });
      // ОТМЕНЁННАЯ — ЦВЕТОМ ОТМЕНЫ. Отмена выключена — `null`: блок рисует
      // прежнюю серую отмену (`useBlockColors` отличает их по этому).
      if (a.status === "cancelled") return cancelledColor;
      // СОБЫТИЕ НЕ ИМЕЕТ НИ КЛИЕНТА, НИ ОБЪЕКТА, НИ УСЛУГ ПО ОПРЕДЕЛЕНИЮ:
      // палитра «чего не хватает» к нему не применяется — иначе обед в
      // календаре горел бы «нет клиента».
      if (a.kind !== "work") return a.color_override || base;
      const hidden = paymentHiddenFor(a);
      return resolveRecordColor({
        override: a.color_override,
        paid: paymentOn && !hidden && fullyPaid(a) ? paidColor : null,
        prepaid: paymentOn && !hidden && partlyPaid(a) ? prepaidColor : null,
        filled: recordFilledFor(a, todayYmd, hidden, colorMinutes),
        base,
        palette: situationPalette,
        active: activeSituations,
        fallback: fallbackColor,
      });
    },
    [
      autoColorRule,
      cities,
      labelFor,
      teamColor,
      serviceColorById,
      situationPalette,
      activeSituations,
      fallbackColor,
      todayYmd,
      colorMinutes,
      paymentHiddenFor,
      cancelledColor,
      paymentOn,
      paidColor,
      prepaidColor,
    ],
  );
  // ЧУЖАЯ МЕТКА НА БЛОКЕ ЗАПИСИ (подсветка окантовкой другого цвета, когда метка другая). Правило и его
  // границы — в `appointment-label.ts`; здесь только связка с меткой дня,
  // которую календарь уже считает.
  const offLabelFor = useCallback(
    (a: Appointment) =>
      resolveOffDayLabel({
        city: a.city,
        dayLabelName: labelFor(a.date)?.name ?? null,
        cities,
      }),
    [labelFor, cities],
  );
  // ЛЕНТА НАЗЫВАЕТ ДЫРУ СЛОВОМ. Она служит сетке легендой: цвет один на три
  // ситуации различает их слишком слабо для дальтоника, а в списке есть место
  // для слова. Слово — того же правила, что цвет (`resolveRecordColor`):
  // строку, которую покрасили «Оплачено» или «Предоплата», дыра не называет —
  // иначе «Нет объекта» стояло только под зелёными строками.
  const situationFor = useCallback(
    (a: Appointment): string | null => {
      const hidden = paymentHiddenFor(a);
      if (a.kind === "work" && a.status !== "cancelled" && paymentOn && !hidden) {
        const owes = !recordFilledFor(a, todayYmd, hidden, colorMinutes).paid;
        if ((fullyPaid(a) && paidColor) || (!owes && partlyPaid(a) && prepaidColor)) return null;
      }
      const id = appointmentSituation(a, {
        palette: situationPalette,
        active: activeSituations,
        todayYmd,
        paymentHidden: hidden,
      });
      return id
        ? COLOR_SITUATIONS.find((s) => s.id === id)?.label ?? null
        : null;
    },
    [
      situationPalette,
      activeSituations,
      todayYmd,
      paymentHiddenFor,
      paymentOn,
      colorMinutes,
      paidColor,
      prepaidColor,
    ],
  );

  // ЛЕНТА НАЗЫВАЕТ И НЕЗАКРЫТУЮ РАБОТУ. В сетке просрочка говорит толщиной
  // канта — каналом СРАВНИТЕЛЬНЫМ: на сплошь просроченной прошлой неделе все
  // канты одинаково толстые, и «сколько висит» по ним не прочесть. В списке
  // для слова есть место.
  const overdueFor = useCallback(
    (a: Appointment) => isOverdue(a, todayYmd, nowMinutes),
    [todayYmd, nowMinutes],
  );

  // Сетке хватает цвета: в колонке дня словам места нет.
  const offLabelColorFor = useCallback(
    (a: Appointment): string | null => offLabelFor(a)?.color ?? null,
    [offLabelFor],
  );

  // Тап по дате всегда открывает метки. Даже если у команды их ещё нет,
  // DayLabelSheet показывает честное пустое состояние и ведёт в настройки.
  // Иначе новый диспетчер нажимал на дату в ожидании метки, а приложение
  // молча переключало вид календаря. Провал в День/Неделю остаётся на долгом
  // нажатии, как и подсказывает accessibilityHint в ячейке даты.
  // Label tint — the label colour washes the day columns very lightly (web
  // DayColumn tintByLabel, Phase I41). The brigade «Метки» setting
  // team.tint_days_by_label (default on) drops the resolver entirely.
  const labelTintFor = useMemo(() => {
    if (!(activeTeam?.tint_days_by_label ?? true)) return undefined;
    // Два уровня, и оба нужны: командный `tint_days_by_label` гасит заливку
    // во всём календаре разом, метка-уровневый `tint_day` — только свою.
    return (dateYmd: string) => {
      const label = labelFor(dateYmd);
      return label?.tint ? label.color : null;
    };
  }, [activeTeam?.tint_days_by_label, labelFor]);
  // Web CityPickerModal pickerList: активные метки справочника, суженные до
  // меток команды, когда они заданы; пустой список команды при заданном
  // default_city → весь активный справочник (web parity).
  const labelOptions = useMemo(
    () =>
      // ПОДБОРА БОЛЬШЕ НЕТ. Здесь стоял фильтр по `teams.cities` — списку
      // имён, подобранных команде из ОБЩЕГО справочника. С 29 августа метка
      // принадлежит команде, и `cities` уже приходят её собственные; старый
      // фильтр стал не сужением, а ПОТЕРЕЙ: у команды со списком из одного
      // имени её же вторая метка исчезала из выбора.
      cities
        .filter((c) => c.is_active && !c.deleted_at)
        .map((c) => ({ name: c.name, color: c.color ?? t.accent })),
    [cities, t.accent],
  );

  return {
    situationPalette, activeSituations, citiesQuery, dayCitiesQuery, cities,
    setDayCityMut, labelFor, teamColorFor, offLabelFor, situationFor, overdueFor,
    offLabelColorFor, labelTintFor, labelOptions,
  };
}

export type RecordColors = ReturnType<typeof useRecordColors>;
