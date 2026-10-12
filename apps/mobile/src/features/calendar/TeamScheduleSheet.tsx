import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { DEFAULT_CALENDAR_SETTINGS } from "@babun/shared/local/calendar-settings";
import {
  timeToMinutes,
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
import { GUTTER } from "@/components/ui/tokens";
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
} from "@/features/calendar/schedule-days";
import {
  effectiveWorkHours,
  hourLabel,
} from "@/features/calendar/setting-options";

// ─── ГРАФИК КОМАНДЫ — ОДИН ЛИСТ СНИЗУ ────────────────────────────────
//
// Владелец 2026-08-17: «график команды хочу, чтоб снизу вытягивалось полностью
// и там уже происходила настройка; продумай правильную структуру, чтобы
// компактно и удобно настраивать по дням».
//
// ЧТО БЫЛО. Три этажа навигации: страница «Рабочий график» со списком семи дней
// → страница одного дня недели → (внутри) перерывы. Поставить команде
// «Пн–Пт 09:00–18:00» стоило захода в настройки, тапа по дню, правки, «назад»,
// и так по кругу — а увидеть неделю целиком было можно только в списке, где у
// каждого дня одна строка и никакого сравнения.
//
// ЧТО СТАЛО. Неделя лежит СЕМЬЮ КОЛОНКАМИ сверху: под каждым днём его часы или
// «—» у выходного. Разные часы, забытый выходной, «в субботу до 15:00» видны
// одним взглядом и БЕЗ чтения — их видно как рисунок. Тап по колонке
// переключает редактор ПОД ней, на месте. Навигации внутрь больше нет вовсе —
// ни одного push на всю настройку недели.
//
// ОДИН КОНТРОЛ ВРЕМЕНИ НА ВЕСЬ ДЕНЬ. Смена и перерывы — это одни и те же два
// числа, поэтому барабан здесь ОДИН, а над ним ряд чипов выбирает, ЧТО он
// сейчас правит: «Смена» либо конкретный перерыв. Раньше перерыв правился
// парой компактных нативных пикеров ПРЯМО В СТРОКЕ — то есть в листе жили два
// разных контрола времени сразу, против закона DS §5 («время выбирают два
// закольцованных барабана»), и строка перерыва занимала 52pt на два числа.
// Теперь перерыв — чип со своими часами, а удаление появляется ровно у
// выбранного: у невыбранного «Убрать» было бы третьим элементом в строке,
// которую и так читают глазами, а не тапают.
//
// ЭТО ИСКЛЮЧЕНИЕ ИЗ ЗАКОНА «настройка — всегда страница» (DS §5, 2026-08-02), и
// оно узаконено там же: у графика набор мелкий и сравнительный (семь дней,
// два числа в каждом), а лист даёт ровно то, чего требует такая работа —
// держать всю неделю перед глазами, пока правишь один день.
//
// ОСОБЫХ ДНЕЙ В ЛИСТЕ НЕТ (владелец 2026-08-17: «убери, мне кажется лучше
// убрать»). Лист отвечает на один вопрос — «когда эта команда работает по
// неделе»; конкретные даты — другой вопрос и другая частота, и список из двух
// строк внизу отбирал у недели место, ничего не объясняя. Страница «Особый
// день» (другие часы на одну дату) снесена 2026-09-24 по слову владельца:
// выходной на дату — тумблером в шторке метки дня, перерыв — долгим нажатием
// по свободному месту. `date_overrides` живёт только ради выходного на дату.

// ОБЩЕЕ ВРЕМЯ — ПО УМОЛЧАНИЮ, ДНИ — ПО КНОПКЕ (владелец 11.10: «если я меняю
// график, я не должен выбирать на каждый день, а ставлю общее время, а если
// нужно распределить по дням — нажимаю кнопку, и открывается разбивка»).
// Лист открывается общим видом: отмеченные рабочие дни и одни часы на все.
// «По дням» — та же неделя колонками и правка одного дня. Неделя с разными
// часами открывается сразу по дням: общий вид соврал бы про неё.
//
// ОДИН ЭКРАН ВМЕСТО ДВУХ РЕЖИМОВ (владелец 12.10: «правильно продумай этот
// блок… можно делать выходной… нажимаю „по дням“ — открывает по дням, а
// закрываю — всё ровно те же дни»). Режимы «общий» и «по дням» врали: «Для
// всех дней» лишь переключал вид, и общий вид показывал часы первого дня
// при разных часах недели. Теперь: дни — кнопками (синий — рабочий, серый —
// выходной), «Рабочие часы» — одни на все, тумблер «Разные часы по дням»
// раскрывает список рабочих дней со своими часами; выключение тумблера
// ПИШЕТ всем дням одни часы — на экране ровно то, что в базе.
//
// ПЕРЕРЫВОВ В ЛИСТЕ БОЛЬШЕ НЕТ (владелец 11.10: «перерыв давай уберём») — ни
// перерывов дня, ни «Перерыва после записи». В базе их нет ни у одной команды
// (проверено 11.10); поля графика остались, вернуть интерфейс можно, не
// трогая данные.

export function TeamScheduleSheet({
  visible,
  teamId,
  teamName,
  onClose,
}: {
  visible: boolean;
  teamId: string | undefined;
  teamName?: string;
  /** Буфер команды после каждой записи; `null` — «как у компании». */
  buffer?: number | null;
  /** Нет — карточки перерыва нет: тому, кому перерыв команды не открыт.
   *  Перерыв хранится в самой команде; сотрудник с «График команды: Видит и
   *  меняет» пишет его своей дверью `member_update_team` (30.09). */
  onBufferChange?: (minutes: number) => void;
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
      // НИЧЕГО НЕ РАСКРЫТО НА ВХОДЕ (владелец 2026-08-17: «пусть будет не сразу
      // открытые тумблера — рабочие часы я должен нажать, и только потом оно
      // открывает»).
      setOpen(null);
      setPerDay(!sameHoursEveryDay(schedule ?? null));
    }
    wasVisible.current = visible;
  }, [visible]);

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

  /** Правка ОДНОГО ДНЯ поверх СВЕЖЕГО графика команды (аудит 04.10).
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

  const hm = (v: string) => {
    const [h, m] = v.split(":").map(Number);
    return { hour: Number.isFinite(h) ? h : 0, minute: Number.isFinite(m) ? m : 0 };
  };
  const text = (v: { hour: number; minute: number }) =>
    `${String(v.hour).padStart(2, "0")}:${String(v.minute).padStart(2, "0")}`;

  // КОНЕЦ ОБЯЗАН БЫТЬ ПОЗЖЕ НАЧАЛА: пару «20:00–09:00» сетка молча отвергает
  // (workBand → undefined, день красится ОБЩИМИ часами), то есть настройка дня
  // просто не действует. Двигаем ту границу, которую сейчас не трогают, и
  // минимально — на шаг барабана.
  /** Записать часы: общие — всем дням сразу, дня — только ему. */
  const writePair = (pair: { start: string; end: string }) => {
    if (target === "common") commitDays(ALL_DAYS, () => pair);
    else commitDays([target], () => pair);
  };

  // ПЕРЕСКОК БАРАБАНА ЧЕРЕЗ ПОЛНОЧЬ — НЕ ПРАВКА ДРУГОЙ ГРАНИЦЫ (аудит
  // шестерёнки 03.10). Барабан часов закольцован: конец смены, докрученный за
  // 23, становился 00 — меньше начала, и «двигаем другую границу» ставил
  // начало на 00:00. Смена превращалась в 00:00–00:00, и сетка молча рисовала
  // этот день общими часами. Пересчёт через полночь прижимаем к краю суток,
  // другую границу не трогаем.
  const WRAP_EDGE = 60;
  const DAY_LAST = 23 * 60 + 55;

  const changeStart = (patch: { hour?: number; minute?: number }) => {
    const next = { ...hm(edited.start), ...patch };
    const prevStart = timeToMinutes(edited.start);
    if (prevStart < WRAP_EDGE && next.hour * 60 + next.minute >= DAY_LAST - WRAP_EDGE) {
      // 00 → 23 назад через полночь: начало остаётся в начале суток.
      writePair({ start: "00:00", end: edited.end });
      return;
    }
    const startMin = next.hour * 60 + next.minute;
    const endMin = timeToMinutes(edited.end);
    // Конец обязан быть позже начала: у смены пару «20:00–09:00» сетка молча
    // отвергает (workBand → undefined, день красится ОБЩИМИ часами), у перерыва
    // из неё вышла бы полоса отрицательной длины. Двигаем ту границу, которую
    // сейчас не трогают, и минимально — на шаг барабана.
    const fixedEnd = startMin >= endMin ? Math.min(23 * 60 + 55, startMin + 5) : null;
    writePair({
      start: text(next),
      end:
        fixedEnd != null
          ? text({ hour: Math.floor(fixedEnd / 60), minute: fixedEnd % 60 })
          : edited.end,
    });
  };

  const changeEnd = (patch: { hour?: number; minute?: number }) => {
    const next = { ...hm(edited.end), ...patch };
    const prevEnd = timeToMinutes(edited.end);
    if (prevEnd >= DAY_LAST - WRAP_EDGE && next.hour * 60 + next.minute < WRAP_EDGE) {
      // 23 → 00 вперёд через полночь: конец остаётся в конце суток.
      writePair({ start: edited.start, end: "23:55" });
      return;
    }
    const endMin = next.hour * 60 + next.minute;
    const startMin = timeToMinutes(edited.start);
    const fixedStart = endMin <= startMin ? Math.max(0, endMin - 5) : null;
    writePair({
      start:
        fixedStart != null
          ? text({ hour: Math.floor(fixedStart / 60), minute: fixedStart % 60 })
          : edited.start,
      end: text(next),
    });
  };

  /**
   * Барабан — ОДИН на лист, но рисуется ПОД той строкой, которую правит (выбор
   * владельца 2026-08-17): галки и подсветки тогда не нужно — связь показывает
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
        <View className="px-5">
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
              пишет (владелец 12.10: «можно делать выходной»). */}
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

/** У всех рабочих дней одни часы — график читается общим видом. */
function sameHoursEveryDay(schedule: TeamSchedule | null): boolean {
  if (!schedule) return true;
  const working = allDays(schedule)
    .map(({ day }) => day)
    .filter((d) => d.is_working);
  return working.every((d) => d.start === working[0]?.start && d.end === working[0]?.end);
}
