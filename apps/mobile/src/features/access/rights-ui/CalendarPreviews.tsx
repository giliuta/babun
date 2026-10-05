import { Text, View } from "react-native";
import { Bookmark, CalendarClock, Trash2 } from "lucide-react-native";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SelectList, SelectRow } from "@/components/ui/select-rows";
import { PRESET_COLOR_VALUES } from "@babun/shared/common/utils/colors";
import { SectionCard } from "@/components/ui/SectionCard";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { actionLook } from "@/features/calendar/ActionMenuSheet";
import { DateCell } from "@/features/calendar/date-header";
import { useThemeColors } from "@/theme/colors";

import type { AccessBlock, AccessLevel } from "../access-map";
import { PreviewFrame, levelState } from "./PreviewFrame";
import { previewActions, previewRecord, sampleTile, type SampleTile } from "./preview-sample";

// ВИД ПРАВ КАЛЕНДАРЯ В ШТОРКЕ: кусок сетки дня с записью и свободным
// временем, меню записи по долгому нажатию, метка над днём, график. Что есть
// и что можно — считает `calendarActions`, то же правило, что у календаря
// сотрудника.

const noop = () => {};


const HOUR = 46;

/** Кусок сетки дня: запись в 10:00, свободный час, событие в 12:00. */
function DayGrid({
  color,
  tile,
  free,
  event,
}: {
  color: string;
  /** Подпись записи — с тем, что из неё видно (`sampleTile`); `null` —
   *  записей на сетке нет вовсе («Записи клиентов: Скрыты»). */
  tile: SampleTile | null;
  /** Подпись свободного часа, по которому можно создать; нет — час пустой. */
  free?: string;
  event?: "read" | "write";
}) {
  const t = useThemeColors();
  const hours = ["10:00", "11:00", "12:00"];
  return (
    <Card style={{ marginHorizontal: 16, marginTop: 8, paddingVertical: 6 }}>
      {hours.map((hour, i) => (
        <View key={hour} style={{ flexDirection: "row", height: HOUR }}>
          <Text
            maxFontSizeMultiplier={1.2}
            style={{ width: 52, paddingLeft: 12, paddingTop: 2, fontSize: 12, color: t.faint, fontVariant: ["tabular-nums"] }}
          >
            {hour}
          </Text>
          <View style={{ flex: 1, borderTopWidth: 1, borderTopColor: t.separator, paddingRight: 10, paddingVertical: 4 }}>
            {i === 0 && tile ? (
              <View
                style={{
                  flex: 1,
                  borderRadius: 6,
                  paddingHorizontal: 8,
                  justifyContent: "center",
                  backgroundColor: `${color}2e`,
                  borderLeftWidth: 3,
                  borderLeftColor: color,
                }}
              >
                <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={{ fontSize: 13, fontWeight: "600", color: t.ink }}>
                  {tile.title}
                </Text>
                <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={{ fontSize: 11, color: t.sub }}>
                  {tile.sub}
                </Text>
              </View>
            ) : null}
            {i === 1 && free ? (
              <View
                style={{
                  flex: 1,
                  borderRadius: 6,
                  borderWidth: 1.5,
                  borderStyle: "dashed",
                  borderColor: t.accent,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 13, fontWeight: "600", color: t.accent }}>
                  {free}
                </Text>
              </View>
            ) : null}
            {i === 2 && event ? (
              <View
                style={{
                  height: HOUR / 2,
                  borderRadius: 6,
                  paddingHorizontal: 8,
                  justifyContent: "center",
                  backgroundColor: t.fill,
                }}
              >
                <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={{ fontSize: 12, fontWeight: "600", color: t.body }}>
                  Обед · 12:00–12:30
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      ))}
    </Card>
  );
}

/** Запись и меню по долгому нажатию на неё — пункты тем же видом, что в
 *  меню календаря (`actionLook`). */
export function AppointmentMenuPreview({
  color,
  tile,
  items,
  swatches,
}: {
  color: string;
  tile: SampleTile;
  items: readonly string[];
  /** Строка цветов под пунктом «Цвет». */
  swatches?: boolean;
}) {
  const t = useThemeColors();
  return (
    <View>
      <DayGrid color={color} tile={tile} />
      <Card style={{ marginHorizontal: 16, marginTop: 8, paddingVertical: 8 }}>
        <SelectList>
          {items.map((label) => {
            const look = actionLook(label);
            return (
              <SelectRow
                key={label}
                title={label}
                icon={look?.icon ?? Trash2}
                color={look?.color ?? t.danger}
                onPress={noop}
              />
            );
          })}
        </SelectList>
        {swatches ? (
          <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 4 }}>
            {PRESET_COLOR_VALUES.slice(0, 7).map((swatch) => (
              <View key={swatch} style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: swatch }} />
            ))}
          </View>
        ) : null}
      </Card>
    </View>
  );
}

/** Три дня недели и метка над первым. */
// Имена меток — общие («Метка 1»), без городов: продукт для любого бизнеса
// (владелец 29.09: «это SaaS, стандартная — просто „Метка"»).
const DAY_LABEL = { name: "Метка 1", color: SETTINGS_TILE.teal };

/** Метки команды в выборе — как у него по тапу на число. */
const DAY_LABEL_CHOICES = [
  DAY_LABEL,
  { name: "Метка 2", color: SETTINGS_TILE.orange },
  { name: "Метка 3", color: SETTINGS_TILE.purple },
];

/** Три дня шапки: понедельник с меткой и два за ним. Шапка — крупная, как в
 *  «Дне»: в ней метка названа целиком, а недельная режет имя до 4 букв. */
const WEEK = [28, 29, 30].map((day) => new Date(2026, 8, day));

/** Подпись над видом записей клиентов — что у него на этой ступени. */
const RECORDS_CAPTION: Record<"hidden" | "read" | "write", string> = {
  hidden: "Так у него: день команды пустой",
  read: "Так он видит записи команды",
  write: "Так он создаёт запись: тап по свободному времени",
};

/** Подпись над видом графика команды — что у него на этой ступени. */
const SCHEDULE_CAPTION: Record<"hidden" | "read" | "write", string> = {
  hidden: "Так у него: графика в настройках нет",
  read: "Так он видит график — без правки",
  write: "Так он меняет график команды",
};

/** Подпись над видом записей событий — что у него на этой ступени. */
const EVENTS_CAPTION: Record<"hidden" | "read" | "write", string> = {
  hidden: "Так у него: событий в дне нет",
  read: "Так он видит события команды",
  write: "Так он создаёт событие: тап по свободному времени",
};

/** Подпись над видом дохода и расхода дня (04.10). */
const DAY_MONEY_CAPTION: Record<"hidden" | "read" | "write", string> = {
  hidden: "Так у него: под календарём денег нет",
  read: "Так он видит доход и расход дней — только этого календаря",
  write: "Так он вносит доход и расход дня: тап по полосе",
};

/** ПОЛОСА «ДОХОД / РАСХОД» ПОД СЕТКОЙ — так, как стоит у него под календарём:
 *  оплаты записей и внесённое из календаря, по дням. «Скрыты» — полосы нет
 *  вовсе (остаётся сетка без денег), «Вносит» — ещё и кнопка листа дня. */
function DayMoneyPreview({ level }: { level: "hidden" | "read" | "write" }) {
  const t = useThemeColors();
  const days = [
    { day: "Пн", income: "€120", expense: "€15" },
    { day: "Вт", income: "€0", expense: "€0" },
    { day: "Ср", income: "€85", expense: "€8" },
  ];
  return (
    <Card style={{ marginHorizontal: 16, marginTop: 8, paddingVertical: 8 }}>
      <View style={{ flexDirection: "row" }}>
        <View style={{ width: 64, paddingRight: 8, alignItems: "flex-end", justifyContent: "flex-end" }}>
          {level === "hidden" ? null : (
            <>
              <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 11, fontWeight: "600", color: t.sub }}>Доход</Text>
              <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 11, fontWeight: "600", color: t.sub }}>Расход</Text>
            </>
          )}
        </View>
        {days.map((d, i) => (
          <View
            key={d.day}
            style={{ flex: 1, alignItems: "center", borderLeftWidth: i === 0 ? 0 : 1, borderLeftColor: t.separator }}
          >
            <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 12, color: t.faint, marginBottom: 4 }}>{d.day}</Text>
            {level === "hidden" ? null : (
              <>
                <Text
                  maxFontSizeMultiplier={1.2}
                  style={{ fontSize: 12, fontWeight: "600", fontVariant: ["tabular-nums"], color: d.income === "€0" ? t.faint : t.success }}
                >
                  {d.income}
                </Text>
                <Text
                  maxFontSizeMultiplier={1.2}
                  style={{ fontSize: 12, fontWeight: "600", fontVariant: ["tabular-nums"], color: d.expense === "€0" ? t.faint : t.danger }}
                >
                  {d.expense}
                </Text>
              </>
            )}
          </View>
        ))}
      </View>
      {level === "write" ? (
        <View style={{ marginTop: 10, marginHorizontal: 12 }}>
          <Button variant="secondary" label="Добавить расход" onPress={noop} />
        </View>
      ) : null}
    </Card>
  );
}

/** Подпись над видом метки дня — что с ней у человека на этой ступени. */
const DAY_LABEL_CAPTION: Record<"hidden" | "read" | "write", string> = {
  hidden: "Так у него: дни без меток",
  read: "Так он видит метку дня",
  write: "Так он ставит метку: тап по числу",
};

/** МЕТКА ДНЯ ТАК, КАК ЕЁ ВИДИТ СОТРУДНИК (владелец 29.09: «открывается
 *  шторка, показывается, как это выглядит, этот блок, и что он может с этим
 *  делать»). Шапка недели — настоящая ячейка календаря (`DateCell`): «Не
 *  видит» — дни без метки, «Видит» — метка под числом, «Меняет» — под шапкой
 *  ещё и выбор метки, тот же, что открывается у него по тапу на число. */
function DayLabelPreview({ level }: { level: "hidden" | "read" | "write" }) {
  return (
    <>
      <Card style={{ marginHorizontal: 16, marginTop: 8, flexDirection: "row", paddingVertical: 6 }}>
        {WEEK.map((date, i) => (
          <DateCell
            key={date.getDate()}
            date={date}
            size="lg"
            isToday={false}
            label={i === 0 && level !== "hidden" ? DAY_LABEL : null}
          />
        ))}
      </Card>
      {level === "write" ? (
        <View style={{ marginTop: 8 }}>
          <SelectList>
            {DAY_LABEL_CHOICES.map((choice, i) => (
              <SelectRow
                key={choice.name}
                icon={Bookmark}
                title={choice.name}
                color={choice.color}
                selected={i === 0}
                onPress={noop}
              />
            ))}
          </SelectList>
        </View>
      ) : null}
    </>
  );
}

export function CalendarPreview({
  blockKey,
  blocks,
  levels,
  teamColor,
}: {
  blockKey: string;
  blocks: readonly AccessBlock[];
  levels: Readonly<Record<string, AccessLevel>>;
  teamColor: string;
}) {
  const actions = previewActions(blocks, levels);
  const tile = sampleTile(previewRecord(blocks, levels));
  // Событие на сетке — если он их видит: сетка в шторке та же, что у него.
  const seenEvent = actions.events === "hidden" ? undefined : actions.events;
  switch (blockKey) {
    case "calendar.records": {
      // ЗАПИСИ КЛИЕНТОВ ТАК, КАК ИХ ВИДИТ СОТРУДНИК (30.09): «Скрыты» — день
      // команды пустой, «Только видит» — запись на сетке, «Видит и создаёт» —
      // ещё и свободное время, по которому он создаёт запись.
      const level = levels["calendar.records"] ?? "off";
      const state = level === "off" ? "hidden" : level === "write" ? "write" : "read";
      return (
        <PreviewFrame state={state === "hidden" ? "read" : state} caption={RECORDS_CAPTION[state]} captionOff={state === "hidden"}>
          <DayGrid color={teamColor} tile={state === "hidden" ? null : tile} free={state === "write" ? "Новая запись" : undefined} />
        </PreviewFrame>
      );
    }
    case "calendar.create":
      return (
        <PreviewFrame state={actions.create ? "can" : "cannot"}>
          <DayGrid color={teamColor} tile={tile} free="Новая запись" event={seenEvent} />
        </PreviewFrame>
      );
    case "calendar.move":
      return (
        <PreviewFrame state={actions.move ? "can" : "cannot"}>
          {/* Всё меню записи по долгому нажатию — одно право (владелец 30.09). */}
          <AppointmentMenuPreview
            color={teamColor}
            tile={tile}
            items={["Свободное перемещение", "Перенести", "Копировать", "Цвет"]}
          />
        </PreviewFrame>
      );
    case "calendar.cancel":
      return (
        <PreviewFrame state={actions.cancel ? "can" : "cannot"}>
          <AppointmentMenuPreview color={teamColor} tile={tile} items={["Отменить визит", "Удалить"]} />
        </PreviewFrame>
      );
    case "calendar.events": {
      // ЗАПИСИ СОБЫТИЙ — ТАК ЖЕ, КАК ЗАПИСИ КЛИЕНТОВ (владелец 30.09): «Скрыты»
      // — в дне нет события, «Только видит» — обед на сетке, «Видит и
      // создаёт» — ещё и свободное время под новое событие.
      const state = actions.events;
      return (
        <PreviewFrame state={state === "hidden" ? "read" : state} caption={EVENTS_CAPTION[state]} captionOff={state === "hidden"}>
          <DayGrid
            color={teamColor}
            tile={tile}
            event={state === "hidden" ? undefined : state}
            free={state === "write" ? "Новое событие" : undefined}
          />
        </PreviewFrame>
      );
    }
    case "calendar.day_labels": {
      // Закрытая метка — это дни без неё, а не бледный блок: сама шапка
      // недели у него на месте, пропадает только метка.
      const level = actions.dayLabels;
      return (
        <PreviewFrame
          state={level === "hidden" ? "read" : levelState(level)}
          caption={DAY_LABEL_CAPTION[level]}
          captionOff={level === "hidden"}
        >
          <DayLabelPreview level={level} />
        </PreviewFrame>
      );
    }
    case "calendar.day_money": {
      const level = levels["calendar.day_money"] ?? "off";
      const state = level === "off" ? "hidden" : level === "write" ? "write" : "read";
      return (
        <PreviewFrame state={state === "hidden" ? "read" : state} caption={DAY_MONEY_CAPTION[state]} captionOff={state === "hidden"}>
          <DayMoneyPreview level={state} />
        </PreviewFrame>
      );
    }
    case "calendar.schedule": {
      // ГРАФИК — ТОЙ ЖЕ СТРОКОЙ, ЧТО В НАСТРОЙКАХ КАЛЕНДАРЯ: «Только видит» —
      // строка без двери, «Видит и меняет» — дверь в график.
      const state = actions.schedule;
      return (
        <PreviewFrame state={state} caption={SCHEDULE_CAPTION[state]}>
          <SectionCard>
            <SettingsRow
              tile={SETTINGS_TILE.blue}
              icon={CalendarClock}
              title="График команды"
              sub="Пн–Вс · 10:00–20:00"
              onPress={state === "write" ? noop : undefined}
            />
          </SectionCard>
        </PreviewFrame>
      );
    }
    default:
      return null;
  }
}
