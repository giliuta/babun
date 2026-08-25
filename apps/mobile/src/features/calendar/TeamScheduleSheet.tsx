import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { DEFAULT_CALENDAR_SETTINGS } from "@babun/shared/local/calendar-settings";
import {
  timeToMinutes,
  WEEKDAY_NAMES,
  type TeamSchedule,
  type WeekdayKey,
} from "@babun/shared/local/schedule";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { Divider } from "@/components/ui/Divider";
import { SectionCard } from "@/components/ui/SectionCard";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { ValueRow } from "@/components/ui/ValueRow";
import { SwipeRow } from "@/components/ui/SwipeRow";
import {
  MINUTE_STEP,
  TimeRangePicker,
  TimeWheelPair,
} from "@/components/ui/TimeWheel";
import { GUTTER } from "@/components/ui/tokens";
import { Trash2 } from "lucide-react-native";
import { haptics } from "@/lib/haptics";
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
import { formatHm } from "@/features/calendar/window";


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
// строк внизу отбирал у недели место, ничего не объясняя. Модель
// (`date_overrides`) и страница-редактор `/calendar/[teamId]/date/[date]` живы —
// у них сейчас нет двери, и это открытый вопрос к владельцу.

export function TeamScheduleSheet({
  visible,
  teamId,
  teamName,
  buffer,
  onBufferChange,
  onClose,
}: {
  visible: boolean;
  teamId: string | undefined;
  teamName?: string;
  /** Буфер команды после каждой записи; `null` — «как у компании». */
  buffer?: number | null;
  onBufferChange: (minutes: number) => void;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const { data: settings } = useCalendarSettings();
  const { data: schedule } = useTeamSchedule(teamId);
  const upsert = useUpsertTeamSchedule();
  const [active, setActive] = useState<WeekdayKey>("mon");
  const [bufferOpen, setBufferOpen] = useState(false);
  /** Что правит барабан: часы дня, один из перерывов, либо ничего (все строки
   *  свёрнуты — тогда день читается коротким списком). */
  const [target, setTarget] = useState<
    { kind: "none" } | { kind: "shift" } | { kind: "break"; index: number }
  >({ kind: "none" });

  // Каждое ОТКРЫТИЕ начинает с понедельника и со смены — но только по фронту:
  // фоновый рефетч графика не должен перекидывать день, который сейчас правят.
  const wasVisible = useRef(false);
  useEffect(() => {
    if (visible && !wasVisible.current) {
      setActive("mon");
      // НИЧЕГО НЕ РАСКРЫТО НА ВХОДЕ (владелец 2026-08-17: «пусть будет не сразу
      // открытые тумблера — рабочие часы я должен нажать, и только потом оно
      // открывает»). Лист открывается коротким списком дня: сначала видно
      // ЧТО стоит, и только потом правят.
      setTarget({ kind: "none" });
    }
    wasVisible.current = visible;
  }, [visible]);

  // Строки графика ещё нет: сетку красят общие рабочие часы. Показываем ИХ — и
  // первая же правка материализует строку из них же, поэтому после сохранения
  // ничего не «прыгает». Фолбэк берём общим резолвером: свой (?? 6 / ?? 22)
  // показывал бы часы, которых никто не задавал и которые не действуют.
  const gWork = effectiveWorkHours(settings ?? DEFAULT_CALENDAR_SETTINGS);
  const base: TeamSchedule = schedule ?? {
    start: hourLabel(gWork.start),
    end: hourLabel(gWork.end),
    breaks: [],
  };
  const days = allDays(base);
  const day = dayOf(base, active);
  // Выбранный перерыв мог исчезнуть под нами: смена дня, чужая правка,
  // удаление. Барабану нужны РЕАЛЬНЫЕ часы, поэтому цель, потерявшая свой
  // перерыв, читается как смена — молча и без пустого экрана.
  const brk =
    target.kind === "break" ? (day.breaks[target.index] ?? null) : null;
  const edited = brk ?? { start: day.start, end: day.end };

  // ПЕРЕРЫВ ПОСЛЕ ЗАПИСИ ЧИТАЕТСЯ КАК ВРЕМЯ (владелец 2026-08-17: «тумблер
  // должен быть такой же — 01:05, точно так же, как рабочие часы: слева часы,
  // справа минуты, а если ничего нет, значит 00:00»). Хранится он минутами,
  // поэтому здесь ровно один перевод в пару и обратно.
  const bufferMinutesTotal = Math.max(
    0,
    Math.round((buffer ?? 0) / MINUTE_STEP) * MINUTE_STEP,
  );
  const bufferTime = {
    hour: Math.floor(bufferMinutesTotal / 60),
    minute: bufferMinutesTotal % 60,
  };
  const bufferLabel = formatHm(bufferTime);
  /** Пишем ТОЛЬКО настоящую правку. Барабан, вставая на своё же значение при
   *  открытии, звал `onChange` — и у команды, которая наследовала перерыв
   *  компании, молча появлялся собственный ноль. */
  const setBuffer = (next: number) => {
    if (next !== bufferMinutesTotal) onBufferChange(next);
  };

  const commit = (next: TeamSchedule) => {
    if (!teamId) return;
    upsert.mutate(
      { teamId, schedule: next },
      { onError: (e) => Alert.alert("Ошибка", (e as Error).message) },
    );
  };

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
  /** Записать пару в то, что сейчас выбрано: смену дня либо этот перерыв. */
  const writePair = (pair: { start: string; end: string }) => {
    if (target.kind === "break" && brk) {
      const next = day.breaks.map((b, i) => (i === target.index ? pair : b));
      commit(withDay(base, active, { breaks: next }));
      return;
    }
    commit(withDay(base, active, pair));
  };

  const changeStart = (patch: { hour?: number; minute?: number }) => {
    const next = { ...hm(edited.start), ...patch };
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

  /** Новый перерыв — час около 13:00, прижатый внутрь смены, и сразу выбранный:
   *  добавили — крутите. Список держим по возрастанию, как читают день. */
  const addBreak = () => {
    haptics.tap();
    const dayStart = timeToMinutes(day.start);
    const dayEnd = timeToMinutes(day.end);
    const from = Math.max(dayStart, Math.min(13 * 60, dayEnd - 60));
    const fresh = {
      start: text({ hour: Math.floor(from / 60), minute: from % 60 }),
      end: text({ hour: Math.floor((from + 60) / 60), minute: (from + 60) % 60 }),
    };
    const next = [...day.breaks, fresh].sort((a, b) =>
      a.start.localeCompare(b.start),
    );
    commit(withDay(base, active, { breaks: next }));
    setTarget({ kind: "break", index: next.indexOf(fresh) });
  };

  /** Убрать перерыв ПО ИНДЕКСУ: и свайп, и меню долгого нажатия говорят про
   *  конкретную строку, а не про «выбранное» — выбор при этом может стоять на
   *  другом перерыве. Подтверждения нет намеренно: перерыв — это два числа,
   *  вернуть его стоит одного тапа «Добавить перерыв», и диалог на такой цене
   *  только мешает. */
  const removeBreakAt = (index: number) => {
    haptics.success();
    commit(
      withDay(base, active, {
        breaks: day.breaks.filter((_, i) => i !== index),
      }),
    );
    // Цель возвращается на часы, только если уносим ТУ строку, что крутится.
    setTarget((prev) =>
      prev.kind === "break" && prev.index === index ? { kind: "shift" } : prev,
    );
  };

  /**
   * Долгое нажатие — ВИДИМЫЙ ДУБЛЁР смахивания, и он обязан быть СИСТЕМНЫМ
   * АЛЕРТОМ, а не листом выбора.
   *
   * Первая версия звала `chooseOption` — и меню оказалось НЕВИДИМЫМ: канонический
   * выбор рисует нижний лист, а мы уже внутри `BottomSheet`, то есть внутри RN
   * `Modal`; лист поверх листа в этом стеке не живёт (тот же закон, по которому
   * дата особого дня ушла страницей). Палец «зажал» — и ничего не произошло,
   * только закрылся лист графика. Поймано в симе 2026-08-17.
   *
   * Алерт — единственное окно, которое встаёт ПОВЕРХ модалки, поэтому дублёр
   * жеста живёт в нём. Он же берёт на себя подтверждение: у долгого нажатия,
   * в отличие от свайпа, нет промежуточной кнопки, которую видно перед тапом.
   */
  const confirmRemove = (index: number, b: { start: string; end: string }) => {
    Alert.alert(`Перерыв ${b.start}–${b.end}`, undefined, [
      { text: "Отмена", style: "cancel" },
      {
        text: "Убрать",
        style: "destructive",
        onPress: () => removeBreakAt(index),
      },
    ]);
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
        key={`${active}-${target.kind}-${
          target.kind === "break" ? target.index : ""
        }`}
        start={hm(edited.start)}
        end={hm(edited.end)}
        onChangeStart={changeStart}
        onChangeEnd={changeEnd}
        labels={
          target.kind === "break"
            ? { start: "Перерыв с", end: "Перерыв до" }
            : { start: "Начало", end: "Конец" }
        }
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

        {/* НЕДЕЛЯ ЧИТАЕТСЯ ЦИФРАМИ. Колонка = день: имя сверху, под ним ЕГО
            ЧАСЫ двумя строками, у выходного прочерк.
            Полос суток, залитых цветом команды, здесь БОЛЬШЕ НЕТ (владелец
            2026-08-17: «всё в красном — дерьмо, до этого было лучше»). Причина
            не во вкусе: 46pt высоты на 1440 минут — это 31 минута на точку, и
            «до 15:00» вместо «до 22:00» полоса физически не могла показать; а
            семь заливок цветом команды на денежном языке продукта (красный =
            расход, зелёный = приход) произносили то, чего в графике нет.
            Цвета команды в этом листе не осталось вовсе — выбранность несёт
            акцент, а не пигмент. */}
        <View
          style={{
            flexDirection: "row",
            paddingHorizontal: 12,
            gap: 4,
            marginBottom: 10,
          }}
        >
          {days.map(({ key, day: d }) => {
            const on = key === active;
            return (
              <Pressable
                key={key}
                onPress={() => {
                  haptics.tap();
                  setActive(key);
                  // Смена дня всё сворачивает: перерыв с прошлого дня в новом
                  // мог не существовать вовсе, а раскрытый барабан на чужих
                  // часах читается как «я это уже правлю».
                  setTarget({ kind: "none" });
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${WEEKDAY_FULL[key]}: ${
                  d.is_working ? `${d.start}–${d.end}` : "выходной"
                }`}
                style={({ pressed }) => ({
                  flex: 1,
                  paddingVertical: 5,
                  borderRadius: t.radius.card,
                  borderCurve: "continuous",
                  alignItems: "center",
                  gap: 2,
                  backgroundColor: on
                    ? `${t.accent}14`
                    : pressed
                      ? t.rowFillPressed
                      : t.fill,
                })}
              >
                <Text
                  maxFontSizeMultiplier={1.1}
                  style={{
                    fontSize: 13,
                    fontWeight: "700",
                    color: on ? t.accent : d.is_working ? t.ink : t.faint,
                  }}
                >
                  {WEEKDAY_NAMES[key]}
                </Text>
                {d.is_working ? (
                  <>
                    <Text
                      maxFontSizeMultiplier={1.1}
                      style={{
                        fontSize: 11,
                        lineHeight: 14,
                        color: on ? t.accent : t.caption,
                        fontVariant: ["tabular-nums"],
                      }}
                    >
                      {d.start}
                    </Text>
                    <Text
                      maxFontSizeMultiplier={1.1}
                      style={{
                        fontSize: 11,
                        lineHeight: 14,
                        color: on ? t.accent : t.caption,
                        fontVariant: ["tabular-nums"],
                      }}
                    >
                      {d.end}
                    </Text>
                  </>
                ) : (
                  // Прочерк на месте часов, а не пустота: колонки обязаны
                  // стоять одной высоты, иначе ряд «дышит» при переключении.
                  <Text
                    maxFontSizeMultiplier={1.1}
                    style={{ fontSize: 11, lineHeight: 28, color: t.muted }}
                  >
                    —
                  </Text>
                )}
              </Pressable>
            );
          })}
        </View>

        {/* ОДИН СПИСОК ЦЕЛЕЙ. Смена — ПЕРВАЯ его строка, а не отдельный
            режим: пока она была «состоянием по умолчанию», у барабана было два
            разных способа получить цель, и «что сейчас крутится» приходилось
            помнить. Теперь цель всегда выбрана строкой, и строка называет её
            СЛОВОМ — этого не умели ни ряд чипов, ни вырез на полосе. */}
        {/* ИМЯ ДНЯ — ЭТО И ЕСТЬ ПОДПИСЬ ТУМБЛЕРА (владелец 2026-08-17: «давай
            рабочий день уберём и поставим вместо этого просто понедельник, чтоб
            меньше шума было»). Раньше день был написан дважды: капс-эйбрау над
            карточкой и слова «Рабочий день» в первой строке.
            ДОБАВЛЕНИЕ ПЕРЕРЫВА ЖИВЁТ В ШАПКЕ КАРТОЧКИ (его выбор там же): своя
            синяя строка внизу забирала 52pt у списка и стояла в одном ряду с
            данными, хотя она — команда, а не факт дня. */}
        <SectionCard
          title="График дня"
          action={
            day.is_working
              ? { label: "＋ Перерыв", onPress: addBreak }
              : undefined
          }
        >
          <SwitchRow
            label={WEEKDAY_FULL[active]}
            value={day.is_working}
            onChange={(v) => commit(withDay(base, active, { is_working: v }))}
          />
          {day.is_working ? (
            <>
              <Divider inset={16} />
              {/* РАСКРЫВАЕТСЯ ПО ТАПУ, и на входе всё свёрнуто. */}
              <ValueRow
                label="Рабочие часы"
                value={`${day.start}–${day.end}`}
                expanded={target.kind === "shift"}
                onPress={() => {
                  haptics.tap();
                  setTarget((prev) =>
                    prev.kind === "shift" ? { kind: "none" } : { kind: "shift" },
                  );
                }}
              />
              {target.kind === "shift" ? WHEEL : null}
              {day.breaks.map((b, i) => (
                <View key={`${b.start}-${b.end}-${i}`}>
                  <Divider inset={16} />
                  {/* УБИРАЮТ ПЕРЕРЫВ ЖЕСТОМ, А НЕ ЛИШНЕЙ КНОПКОЙ (владелец
                      2026-08-17: «удалить перерыв — это должен быть свайп, а не
                      ещё одна кнопка»). Канонический `SwipeRow`: смахнуть влево
                      → кромка «Убрать». Тот же жест уже живёт на счетах и
                      объектах клиента. Долгое нажатие — видимый дублёр словом:
                      без него жест недостижим для VoiceOver (закон DS).
                      `fullSwipe` НЕ включаем: размашистое движение не должно
                      уносить перерыв без тапа по кнопке. */}
                  <SwipeRow
                    label="Убрать"
                    color={t.danger}
                    icon={Trash2}
                    accessibilityLabel={`Убрать перерыв ${b.start}–${b.end}`}
                    onAction={() => removeBreakAt(i)}
                  >
                    <ValueRow
                      label="Перерыв"
                      value={`${b.start}–${b.end}`}
                      expanded={target.kind === "break" && target.index === i}
                      longPressLabel="Убрать перерыв"
                      onPress={() => {
                        haptics.tap();
                        setTarget((prev) =>
                          prev.kind === "break" && prev.index === i
                            ? { kind: "none" }
                            : { kind: "break", index: i },
                        );
                      }}
                      onLongPress={() => confirmRemove(i, b)}
                    />
                  </SwipeRow>
                  {target.kind === "break" && target.index === i
                    ? WHEEL
                    : null}
                </View>
              ))}
            </>
          ) : null}
        </SectionCard>

        {/* ПЕРЕРЫВ ПОСЛЕ ЗАПИСИ — ТОТ ЖЕ ПЕРЕРЫВ, только не в конкретное время,
            а после каждой работы, поэтому он живёт в графике команды. Своей
            КАРТОЧКОЙ, а не строкой дня: он один на команду и внутри карточки
            дня читался бы как свойство понедельника.

            БАРАБАН, А НЕ ШЕСТЬ ЧИПОВ (владелец 2026-08-17: «нет 5 минут, а если
            я хочу 45 минут — надо это продумать»): готовый набор значений
            отвечал только на те вопросы, которые мы придумали за человека.
            Барабан пятиминутками до трёх часов отвечает на любой. Открывается
            тем же тапом по строке, что и часы дня выше. */}
        <SectionCard>
          <ValueRow
            label="Перерыв после записи"
            value={bufferLabel}
            expanded={bufferOpen}
            onPress={() => {
              haptics.tap();
              setBufferOpen((v) => !v);
            }}
          />
          {bufferOpen ? (
            <View style={{ alignItems: "center", paddingBottom: 12 }}>
              <TimeWheelPair
                hour={bufferTime.hour}
                minute={bufferTime.minute}
                onChangeHour={(hour) => setBuffer(hour * 60 + bufferTime.minute)}
                onChangeMinute={(minute) =>
                  setBuffer(bufferTime.hour * 60 + minute)
                }
                labelPrefix="Перерыв после записи"
              />
            </View>
          ) : null}
        </SectionCard>
      </View>
    </BottomSheet>
  );
}
