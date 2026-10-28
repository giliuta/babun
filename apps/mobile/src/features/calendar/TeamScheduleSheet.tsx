import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { DEFAULT_CALENDAR_SETTINGS } from "@babun/shared/local/calendar-settings";
import {
  WEEKDAY_NAMES,
  type TeamSchedule,
  type WeekdayKey,
 DaySchedule } from "@babun/shared/local/schedule";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { Divider } from "@/components/ui/Divider";
import { SectionCard } from "@/components/ui/SectionCard";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { ValueRow } from "@/components/ui/ValueRow";
import { TimeRangePicker } from "@/components/ui/TimeWheel";
import { FOOTER_SIDE, GUTTER } from "@/components/ui/tokens";
import { haptics } from "@/lib/haptics";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";
import { useCalendarSettings } from "@/features/settings/local-settings";
import {
  useTeamSchedule,
  useUpsertTeamSchedule,
} from "@/features/reference/team-schedule";
import {
  allDays,
  dayOf,
  WEEKDAY_FULL,
  withDay,
} from "@/features/reference/schedule-days";
import {
  effectiveWorkHours,
  hourLabel,
} from "@/features/calendar/setting-options";
import { hm, pairOnEnd, pairOnStart, sameHoursEveryDay } from "./team-schedule/schedule-pair";

// ─── ГРАФИК КОМАНДЫ — ОДИН ЛИСТ СНИЗУ ────────────────────────────────
//
// Недельный график команды настраивается в одном листе, без навигации внутрь:
// «Пн–Пт 09:00–18:00» ставится за пару тапов, а не заходом в настройки, на
// страницу дня и обратно.
//
// ЭТО ИСКЛЮЧЕНИЕ ИЗ ЗАКОНА «настройка — всегда страница» (DS §5), и оно
// узаконено там же: у графика набор мелкий и сравнительный (семь дней, два
// числа в каждом), а лист даёт ровно то, чего требует такая работа — держать
// всю неделю перед глазами, пока правишь один день.
//
// ОДИН КОНТРОЛ ВРЕМЕНИ НА ВЕСЬ ЛИСТ: барабан один (закон DS §5 — «время
// выбирают два закольцованных барабана»), и раскрыт он под той строкой, часы
// которой правят. Два разных контрола времени в одном листе нарушили бы закон.
//
// ОДИН ЭКРАН, А НЕ ДВА РЕЖИМА: дни — кнопками (синий — рабочий, серый —
// выходной), «Рабочие часы» — одни на все, тумблер «Разные часы по дням»
// раскрывает список рабочих дней со своими часами. Выключение тумблера ПИШЕТ
// всем дням одни часы — на экране ровно то, что в базе. Режим-переключатель
// вида врал бы: общий вид показывал бы часы первого дня при разных часах недели.
// Неделя с разными часами открывается сразу по дням. Ничего не раскрыто на
// входе: рабочие часы человек открывает сам.
//
// ОСОБЫХ ДНЕЙ И ПЕРЕРЫВОВ В ЛИСТЕ НЕТ: лист отвечает на один вопрос — «когда
// команда работает по неделе». Выходной на дату ставится тумблером в шторке
// метки дня (`date_overrides` живёт только ради него). Поля перерывов в
// графике остались в данных, но интерфейса у них нет.

export function TeamScheduleSheet({
  visible,
  teamId,
  teamName,
  onClose,
}: {
  visible: boolean;
  teamId: string | undefined;
  teamName?: string;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const { data: settings } = useCalendarSettings();
  const { data: schedule, isPending: schedulePending } = useTeamSchedule(teamId);
  const upsert = useUpsertTeamSchedule();
  /** Разные часы по дням — тумблер; на входе — по графику. */
  const [perDay, setPerDay] = useState(false);
  /** Чей барабан раскрыт: общих часов, одного дня или ничей. */
  const [open, setOpen] = useState<"common" | WeekdayKey | null>(null);

  // Каждое ОТКРЫТИЕ начинает с понедельника и со смены — но только по фронту:
  // фоновый рефетч графика не должен перекидывать день, который сейчас правят.
  const wasVisible = useRef(false);
  useEffect(() => {
    if (visible && !wasVisible.current) {
      // НИЧЕГО НЕ РАСКРЫТО НА ВХОДЕ: рабочие часы человек открывает сам.
      setOpen(null);
      setPerDay(!sameHoursEveryDay(schedule ?? null));
    }
    wasVisible.current = visible;
  }, [visible, schedule]);

  // Строки графика ещё нет: сетку красят общие рабочие часы. Показываем ИХ — и
  // первая же правка материализует строку из них же, поэтому после сохранения
  // ничего не «прыгает». Фолбэк берём общим резолвером: свой (?? 6 / ?? 22)
  // показывал бы часы, которых никто не задавал и которые не действуют.
  const gWork = effectiveWorkHours(settings ?? DEFAULT_CALENDAR_SETTINGS);
  const companyBase: TeamSchedule = {
    start: hourLabel(gWork.start),
    end: hourLabel(gWork.end),
    breaks: [],
  };
  const base: TeamSchedule = schedule ?? companyBase;
  const days = allDays(base);
  // Общие часы — часы первого рабочего дня (без «разных по дням» они у всех одни).
  const firstWorking = days.find(({ day: d }) => d.is_working)?.day ?? base;
  const common = { start: firstWorking.start, end: firstWorking.end };
  const target: "common" | WeekdayKey = open ?? "common";
  const targetDay = target === "common" ? null : dayOf(base, target);
  const edited = targetDay ? { start: targetDay.start, end: targetDay.end } : common;

  /** Правка ОДНОГО ДНЯ поверх СВЕЖЕГО графика команды.
   *
   *  Апсерт ЗАМЕНЯЕТ блоб целиком. Лист собирал его из кэша: если чтение
   *  графиков упало (после трёх попыток `isPending` уже false) или «Выходной»
   *  поставили на другом телефоне, основой были общие часы или старая копия
   *  — и первый же поворот барабана стирал на сервере свои часы других
   *  дней, перерывы и выходные на даты. Теперь хук берёт график с сервера
   *  (`(current) => next`), и на него ложится только этот день; общие часы —
   *  лишь когда строки у команды правда нет. */
  const commitDays = (
    weekdays: readonly WeekdayKey[],
    patchOf: (day: DaySchedule) => Partial<DaySchedule>,
  ) => {
    if (!teamId) return;
    // Карта графиков ещё не пришла — правке не на что опереться на экране.
    if (schedulePending) return;
    upsert.mutate(
      {
        teamId,
        schedule: (current) =>
          weekdays.reduce(
            (from, weekday) => withDay(from, weekday, patchOf(dayOf(from, weekday))),
            current ?? companyBase,
          ),
      },
      { onError: (e) => notify("Ошибка", (e as Error).message) },
    );
  };
  const ALL_DAYS = days.map(({ key }) => key);

  // КОНЕЦ ОБЯЗАН БЫТЬ ПОЗЖЕ НАЧАЛА: пару «20:00–09:00» сетка молча отвергает
  // (workBand → undefined, день красится ОБЩИМИ часами), то есть настройка дня
  // просто не действует. Двигаем ту границу, которую сейчас не трогают, и
  // минимально — на шаг барабана. Арифметика пары — `team-schedule/schedule-pair.ts`.
  /** Записать часы: общие — всем дням сразу, дня — только ему. */
  const writePair = (pair: { start: string; end: string }) => {
    if (target === "common") commitDays(ALL_DAYS, () => pair);
    else commitDays([target], () => pair);
  };

  const changeStart = (patch: { hour?: number; minute?: number }) => writePair(pairOnStart(edited, patch));
  const changeEnd = (patch: { hour?: number; minute?: number }) => writePair(pairOnEnd(edited, patch));

  /**
   * Барабан — ОДИН на лист, но рисуется ПОД той строкой, которую правит: галки и подсветки тогда не нужно — связь показывает
   * МЕСТО. Крутишь то, под чем он раскрыт.
   */
  const WHEEL = (
    <View style={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12 }}>
      <TimeRangePicker
        // key по дню и цели: барабаны — прокручиваемые ленты, и
        // переключение обязано ПЕРЕСОБРАТЬ их на новых часах, а не
        // доезжать анимацией с чужого значения.
        key={target}
        start={hm(edited.start)}
        end={hm(edited.end)}
        onChangeStart={changeStart}
        onChangeEnd={changeEnd}
        labels={{ start: "Начало", end: "Конец" }}
        // Смена и перерыв заканчиваются часом суток, а не их концом:
        // 24:00 — граница ОКНА календаря, здесь такого времени нет.
        allowEndOfDay={false}
      />
    </View>
  );

  return (
    <BottomSheet
      padded={false}
      visible={visible}
      onClose={onClose}
      title="График команды"
      scroll
      maxHeightRatio={0.92}
      footer={
        <View style={{ paddingHorizontal: FOOTER_SIDE }}>
          <Button label="Применить" onPress={onClose} />
        </View>
      }
    >
      <View style={{ paddingBottom: 8 }}>
        {teamName ? (
          <Text
            maxFontSizeMultiplier={1.2}
            style={{
              marginBottom: 10,
              paddingHorizontal: GUTTER,
              fontSize: 13,
              color: t.caption,
              textAlign: "center",
            }}
          >
            {teamName}
          </Text>
        ) : null}

        <SectionCard title="Рабочие дни">
          {/* ДНИ — КНОПКАМИ: синий — рабочий, серый — выходной; тап сразу
              пишет (в том числе выходной). */}
          <View style={{ flexDirection: "row", gap: 4, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 12 }}>
            {days.map(({ key, day: d }) => (
              <Pressable
                key={key}
                onPress={() => {
                  haptics.tap();
                  if (open === key) setOpen(null);
                  commitDays([key], () => ({ is_working: !d.is_working }));
                }}
                accessibilityRole="switch"
                accessibilityState={{ checked: d.is_working }}
                accessibilityLabel={`${WEEKDAY_FULL[key]}: ${d.is_working ? "рабочий" : "выходной"}`}
                style={({ pressed }) => ({
                  flex: 1,
                  minHeight: 44,
                  borderRadius: t.radius.card,
                  borderCurve: "continuous",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: d.is_working ? t.accent : pressed ? t.rowFillPressed : t.fill,
                })}
              >
                <Text
                  maxFontSizeMultiplier={1.1}
                  style={{ fontSize: 13, fontWeight: "700", color: d.is_working ? t.onAccent : t.faint }}
                >
                  {WEEKDAY_NAMES[key]}
                </Text>
              </Pressable>
            ))}
          </View>
          {!perDay ? (
            <>
              <Divider inset={16} />
              <ValueRow
                label="Рабочие часы"
                value={`${common.start}–${common.end}`}
                expanded={open === "common"}
                onPress={() => {
                  haptics.tap();
                  setOpen((v) => (v === "common" ? null : "common"));
                }}
              />
              {open === "common" ? WHEEL : null}
            </>
          ) : null}
          <Divider inset={16} />
          <SwitchRow
            label="Разные часы по дням"
            value={perDay}
            onChange={(v) => {
              setOpen(null);
              if (v) {
                setPerDay(true);
                return;
              }
              // Выключили — всем дням одни часы, сразу в базу: закрыл и
              // открыл — то же, что видно сейчас.
              setPerDay(false);
              commitDays(ALL_DAYS, () => common);
            }}
          />
          {perDay
            ? days
                .filter(({ day: d }) => d.is_working)
                .map(({ key, day: d }) => (
                  <View key={key}>
                    <Divider inset={16} />
                    <ValueRow
                      label={WEEKDAY_FULL[key]}
                      value={`${d.start}–${d.end}`}
                      expanded={open === key}
                      onPress={() => {
                        haptics.tap();
                        setOpen((v) => (v === key ? null : key));
                      }}
                    />
                    {open === key ? WHEEL : null}
                  </View>
                ))
            : null}
        </SectionCard>
      </View>
    </BottomSheet>
  );
}

