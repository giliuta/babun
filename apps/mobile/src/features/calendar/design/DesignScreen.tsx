import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import {
  Bookmark,
  Briefcase,
  CalendarRange,
  FileText,
  MapPin,
  Check,
  Clock,
  Lock,
  StickyNote,
  Tags,
  UserRound,
  Wallet,
  type LucideIcon,
} from "lucide-react-native";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { Divider } from "@/components/ui/Divider";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { RecordMark, recordMarkText } from "@/components/ui/RecordMark";
import { RowCaption } from "@/components/ui/card-rows";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import { colorName } from "@babun/shared/common/utils/colors";
import { ColorSheet } from "@/features/appointments/BookingSheets";
import { useCities, useTeams } from "@/features/reference/queries";
import { useServices } from "@/features/services/queries";
import { COLOR_SITUATIONS, type ColorSituation } from "@/features/appointments/record-color";
import {
  AUTO_COLOR_RULES,
  BOOKING_BLOCKS,
  EVENT_BLOCKS,
  useAutoColorRule,
  useBookingBlocks,
  useEventBlocks,
  useFallbackColor,
  useSetAutoColorRule,
  useSetFallbackColor,
  situationDefaults,
  useSetSituationColor,
  useSetSituationPalette,
  useSituationPalette,
  useToggleBookingBlock,
  useToggleEventBlock,
  type AutoColorRule,
  type BookingBlockId,
  type EventBlockId,
} from "@/features/appointments/booking-prefs";
import { usePersonalEventTypes } from "@/features/settings/local-settings";

// «ДИЗАЙН» — КАК ВЫГЛЯДИТ И ИЗ ЧЕГО СОСТОИТ ЗАПИСЬ. ТРИ КАРТОЧКИ, ВСЁ ТАПОМ.
//
// Владелец 2026-09-24, вторым заходом: «продумай каждый кусочек, как лично
// ты бы сделал; „автоматически“ отдельно я бы не вставлял — вижу, как
// выглядит, тапаю по блоку и сразу выбираю цвет; компактнее».
//
// ЦВЕТ. Образец и есть настройка. Сверху — обычная запись: цветом того, от
// чего она красится (команда, метка, услуга); тап — выбрать источник. Под ней
// четыре случая, когда цвет решает правило: нет клиента, нет объекта, нет
// услуг, у источника нет цвета. Тап — палитра, выбор сохраняется сразу.
// «Не красить» — пустой контур: так запись и будет выглядеть, цветом обычной.
// Отдельных списков «автоматически» и «если цвета нет» больше нет — они
// повторяли то, что образцы уже показывают.
//
// БЛОКИ. Одна карточка, чипы и под ними «Клиент | Событие» — вкл. залит
// цветом, выкл. серый. Обязательные блоки не притворяются настройкой: их
// называет строка «Всегда: …».
//
// ТИПЫ СОБЫТИЙ. Дверь на свою страницу, как у услуг и меток.

type ColorTarget = ColorSituation | "fallback";

const RULE_ICON: Record<AutoColorRule, LucideIcon> = {
  team: CalendarRange,
  label: Bookmark,
  service: Briefcase,
};


/** Значок блока формы — тот же, что у сущности в продукте (BLOCKS.md §0.2). */
const BLOCK_ICON: Record<string, LucideIcon> = {
  team: CalendarRange,
  type: Tags,
  when: Clock,
  services: Briefcase,
  label: Bookmark,
  client: UserRound,
  object: MapPin,
  payment: Wallet,
  note: StickyNote,
  files: FileText,
};

const RULE_OPTIONS = [
  { value: "team", label: "Команде" },
  { value: "label", label: "Метке" },
  { value: "service", label: "Услуге" },
] as const satisfies readonly { value: AutoColorRule; label: string }[];

/** Подпись обычной записи в дне-образце. */
const RULE_WORD: Record<AutoColorRule, string> = {
  team: "цвет команды",
  label: "цвет метки",
  service: "цвет услуги",
};

/** СТРОКИ ТАБЛИЦЫ БЛОКОВ: одинаковые блоки записи и события стоят
 *  напротив друг друга (владелец 24.09: «почему разделение — у обоих
 *  команда, метка, время»), различия — своими строками. Порядок — порядок
 *  формы. */
const BLOCK_ROWS: { record: BookingBlockId | null; event: EventBlockId | null }[] = [
  { record: "team", event: "team" },
  { record: "label", event: "label" },
  { record: "when", event: "when" },
  { record: "client", event: "client" },
  { record: "object", event: "object" },
  { record: "services", event: "type" },
  { record: "payment", event: null },
  { record: "note", event: "note" },
  { record: "files", event: "files" },
];

export function DesignScreen() {
  const t = useThemeColors();
  const router = useRouter();

  // ── цвет ──
  const rule = useAutoColorRule();
  const setRule = useSetAutoColorRule();
  const palette = useSituationPalette();
  const setSituationColor = useSetSituationColor();
  const fallback = useFallbackColor();
  const setFallback = useSetFallbackColor();
  const [editingColor, setEditingColor] = useState<ColorTarget | null>(null);
  const [ruleOpen, setRuleOpen] = useState(false);

  // ── блоки ──
  const recordBlocks = useBookingBlocks();
  const toggleRecordBlock = useToggleBookingBlock();
  const eventBlocks = useEventBlocks();
  const toggleEventBlock = useToggleEventBlock();
  const objectsOn = recordBlocks.includes("object");

  // ── типы событий ──
  const typesQuery = usePersonalEventTypes();
  const liveTypes = (typesQuery.data ?? []).filter((type) => !type.hidden);
  // Подпись двери — имена типов, как у «Меток»; пока грузится — пусто.
  const typesSub = typesQuery.isLoading
    ? undefined
    : liveTypes.length === 0
      ? "Типов пока нет"
      : liveTypes.map((type) => type.label).join(", ");

  // ОБЫЧНАЯ ЗАПИСЬ — ЦВЕТОМ ТОГО ИСТОЧНИКА, ЧТО ВЫБРАН: первая команда,
  // первая метка или первая услуга. Нет у источника цвета — запасной.
  const { data: teams = [] } = useTeams();
  const { data: labels = [] } = useCities();
  const { data: services = [] } = useServices();
  const ordinary =
    (rule === "team"
      ? teams[0]?.color
      : rule === "label"
        ? labels[0]?.color
        : services[0]?.color) || fallback;

  // Ситуация про выключенный блок не показывается: у бьюти-мастера объекта нет
  // вовсе, и «нет объекта» для него не дыра, а норма.
  const situations = COLOR_SITUATIONS.filter(
    (s) => s.id !== "noObject" || objectsOn,
  );
  const openColor = (target: ColorTarget) => {
    haptics.tap();
    setEditingColor(target);
  };

  // ПОДСВЕТКА ВКЛЮЧЕНА, если хоть один случай красит. Выключатель пишет
  // палитру целиком: выкл. — все «не красить», вкл. — заводские цвета.
  const setPalette = useSetSituationPalette();
  const highlightOn = situations.some((sit) => palette[sit.id] != null);

  // ДЕНЬ-ОБРАЗЕЦ: записи того же вида, что на сетке. Обычная — цветом
  // источника; незаполненные — своим цветом, а при «не красить» — обычным
  // (так они и лягут на сетку).
  const holeHue = (id: ColorSituation) => palette[id] ?? ordinary;
  const preview: {
    id: string;
    time: string;
    name: string;
    sub: string;
    hue: string;
    onPress: () => void;
  }[] = [
    {
      id: "ordinary",
      time: "09:00",
      name: "Мария",
      sub: `всё заполнено · ${RULE_WORD[rule]}`,
      hue: ordinary,
      onPress: () => {
        haptics.tap();
        setRuleOpen(true);
      },
    },
    ...situations.map((sit, i) => ({
      id: sit.id,
      time: ["11:00", "13:00", "15:00"][i] ?? "17:00",
      name: sit.id === "noClient" ? "Без клиента" : ["Иван", "Олег"][i - 1] ?? "Анна",
      sub: palette[sit.id] ? sit.label.toLowerCase() : `${sit.label.toLowerCase()} · не красить`,
      hue: holeHue(sit.id),
      onPress: () => openColor(sit.id),
    })),
  ];

  const recordOn = (id: string) => recordBlocks.includes(id as BookingBlockId);
  const eventOn = (id: string) => eventBlocks.includes(id as EventBlockId);

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Дизайн" />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        {/* ── ЦВЕТ ЗАПИСИ — КУСОЧЕК КАЛЕНДАРЯ (владелец 24.09: «разбери полностью,
            переделай цвет записи, чтобы улучшить дизайн самого календаря»).
            Сверху — не абстрактные плитки, а день календаря: рельс часов и
            записи ровно того вида, что на сетке, каждая на своём случае
            правила. Тап по записи — её цвет. Под ним три вопроса правила,
            каждый ответ виден и ставится одним тапом:
              «Красить по» — откуда обычный цвет (команда / метка / услуга);
              «Подсвечивать, чего не хватает» — выкл. — все записи обычного
              цвета, вкл. — незаполненные своим цветом, пока не заполнят;
              «Если нет цвета» — запасной. */}
        <SectionCard title="Цвет записи" padded>
          <View style={{ gap: 6 }}>
            {preview.map((row) => (
              <View key={row.id} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Text
                  maxFontSizeMultiplier={1.2}
                  style={{
                    width: 42,
                    fontSize: 13,
                    fontWeight: "600",
                    color: t.sub,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {row.time}
                </Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <ColorTile
                    title={row.name}
                    sub={row.sub}
                    hue={row.hue}
                    height={48}
                    onPress={row.onPress}
                  />
                </View>
              </View>
            ))}
          </View>

          <View style={{ marginTop: 16 }}>
            <StepLabel text="Красить по" first />
            <SegmentedControl
              options={RULE_OPTIONS}
              value={rule}
              onChange={(next) => {
                haptics.tap();
                setRule.mutate(next);
              }}
            />
          </View>
        </SectionCard>
        <SectionCard>
          <SwitchRow
            label="Подсвечивать, чего не хватает"
            value={highlightOn}
            onChange={(on) => {
              haptics.tap();
              setPalette.mutate(
                on
                  ? situationDefaults()
                  : (Object.fromEntries(
                      COLOR_SITUATIONS.map((sit) => [sit.id, null]),
                    ) as typeof palette),
              );
            }}
          />
          <Divider inset={16} />
          <SettingsRow
            swatch={fallback}
            title="Если нет цвета"
            sub={colorName(fallback)}
            onPress={() => openColor("fallback")}
          />
        </SectionCard>
        <RowCaption text="Цвет, выбранный в самой записи, главнее всего." />

        {/* ── БЛОКИ — ДВЕ КОЛОНКИ (владелец 24.09: «клиент слева, событие
            справа, посередине разделитель, вниз всё показано; тапом включаю и
            выключаю»). Обязательные стоят в списке с замком — видно весь
            состав формы, но выключить их нельзя. */}
        <SectionCard title="Блоки">
          <View style={{ flexDirection: "row" }}>
            <View style={{ flex: 1 }}>
              <ColumnTitle text="Клиент" />
            </View>
            <View style={{ width: 1, backgroundColor: t.separator }} />
            <View style={{ flex: 1 }}>
              <ColumnTitle text="Событие" />
            </View>
          </View>
          {BLOCK_ROWS.map((row) => {
            const rec = row.record
              ? BOOKING_BLOCKS.find((b) => b.id === row.record)
              : null;
            const ev = row.event ? EVENT_BLOCKS.find((b) => b.id === row.event) : null;
            // Объекта события нет, пока у компании выключены объекты.
            const noObjects = ev?.id === "object" && !objectsOn;
            return (
              <View key={`${row.record}-${row.event}`} style={{ flexDirection: "row" }}>
                <View style={{ flex: 1 }}>
                  {rec ? (
                    <BlockCell
                      label={rec.label}
                      icon={BLOCK_ICON[rec.id] ?? Bookmark}
                      on={rec.pinned ? true : recordOn(rec.id)}
                      locked={!!rec.pinned}
                      onToggle={() => toggleRecordBlock.mutate(rec.id)}
                    />
                  ) : null}
                </View>
                <View style={{ width: 1, backgroundColor: t.separator }} />
                <View style={{ flex: 1 }}>
                  {ev ? (
                    <BlockCell
                      label={ev.label}
                      icon={BLOCK_ICON[ev.id] ?? Bookmark}
                      on={ev.pinned ? true : !noObjects && eventOn(ev.id)}
                      locked={!!ev.pinned || noObjects}
                      onToggle={() => toggleEventBlock.mutate(ev.id)}
                    />
                  ) : null}
                </View>
              </View>
            );
          })}
        </SectionCard>
        <RowCaption text="Выключенный блок пропадает у всей компании. Данные остаются." />

        {/* ── ТИПЫ СОБЫТИЙ — ДВЕРЬ, КАК У УСЛУГ И МЕТОК (владелец 24.09:
            «отдельной страницей, как и везде»). Все типы и так стоят в
            «Быстром событии» — отдельно это не объясняется. */}
        {eventOn("type") ? (
        <SectionCard>
          <SettingsRow
            tile={SETTINGS_TILE.purple}
            icon={Tags}
            title="Типы событий"
            sub={typesSub}
            onPress={() => {
              haptics.tap();
              router.push("/calendar/event-types" as Href);
            }}
          />
        </SectionCard>
        ) : null}
      </ScrollView>

      {/* Источник обычного цвета — наша шторка выбора со значками и галкой. */}
      <PickerSheet
        visible={ruleOpen}
        title="Обычная запись"
        subtitle="От чего берёт цвет"
        selectedId={rule}
        onClose={() => setRuleOpen(false)}
        items={AUTO_COLOR_RULES.map((r) => ({
          id: r.id,
          label: r.label,
          icon: RULE_ICON[r.id],
          color: SETTINGS_TILE.blue,
          onPress: () => setRule.mutate(r.id),
        }))}
      />

      <ColorSheet
        visible={editingColor != null}
        onClose={() => setEditingColor(null)}
        title={
          editingColor === "fallback"
            ? "Без цвета"
            : COLOR_SITUATIONS.find((s) => s.id === editingColor)?.label
        }
        // «Не красить»: у случая нет автомата — есть отказ от сигнала, и
        // тогда запись красится как обычная. У «Без цвета» отказа нет: это
        // последняя ступень.
        autoLabel="Не красить"
        autoColor={ordinary}
        allowNone={editingColor !== "fallback"}
        commitOnPick
        value={
          editingColor === "fallback"
            ? fallback
            : editingColor
              ? palette[editingColor] ?? null
              : null
        }
        onPick={(color) => {
          if (!editingColor) return;
          if (editingColor === "fallback") {
            if (color) setFallback.mutate(color);
          } else {
            setSituationColor.mutate({ situation: editingColor, color });
          }
          setEditingColor(null);
        }}
      />

    </Screen>
  );
}

/** Образец-кнопка: настоящий блок сетки (`RecordMark`) с названием случая и
 *  его цветом словами. `hue = null` — «не красить», пустой контур. */
function ColorTile({
  title,
  sub,
  a11yColor,
  hue,
  height,
  onPress,
}: {
  title: string;
  sub?: string;
  /** Имя цвета для озвучки, когда подписи на образце нет. */
  a11yColor?: string;
  hue: string | null;
  height: number;
  onPress: () => void;
}) {
  const t = useThemeColors();
  const ink = hue ? recordMarkText(hue, t.ink) : t.ink;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title.replace("\n", " ")}: ${sub ?? a11yColor ?? ""}`}
      style={({ pressed }) => ({ flex: 1, minWidth: 0, opacity: pressed ? 0.7 : 1 })}
    >
      <RecordMark hue={hue} full size={height}>
        <Text
          numberOfLines={2}
          maxFontSizeMultiplier={1.2}
          style={{ fontSize: 13, lineHeight: 16, fontWeight: "700", color: ink }}
        >
          {title}
        </Text>
        {sub ? (
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1.2}
            style={{
              fontSize: 12,
              lineHeight: 15,
              fontWeight: "500",
              color: ink,
              opacity: hue ? 0.85 : 0.6,
            }}
          >
            {sub}
          </Text>
        ) : null}
      </RecordMark>
    </Pressable>
  );
}

/** Шаг правила цвета — тихая строка над образцами. */
function StepLabel({ text, first }: { text: string; first?: boolean }) {
  const t = useThemeColors();
  return (
    <Text
      maxFontSizeMultiplier={1.3}
      style={{ fontSize: 13, color: t.sub, marginTop: first ? 0 : 14, marginBottom: 6 }}
    >
      {text}
    </Text>
  );
}

/** Заголовок колонки блоков — «Клиент» / «Событие». */
function ColumnTitle({ text }: { text: string }) {
  const t = useThemeColors();
  return (
    <Text
      maxFontSizeMultiplier={1.3}
      style={{
        paddingHorizontal: 16,
        paddingTop: 2,
        paddingBottom: 6,
        fontSize: 15,
        fontWeight: "700",
        color: t.ink,
      }}
    >
      {text}
    </Text>
  );
}

/** Строка колонки блоков: значок, слово, справа галка (вкл.) или ничего;
 *  обязательный — замок, тапа нет. */
function BlockCell({
  label,
  icon: Icon,
  on,
  locked,
  onToggle,
}: {
  label: string;
  icon: LucideIcon;
  on: boolean;
  locked: boolean;
  onToggle: () => void;
}) {
  const t = useThemeColors();
  const tone = locked ? t.faint : on ? t.ink : t.faint;
  return (
    <Pressable
      disabled={locked}
      onPress={() => {
        haptics.tap();
        onToggle();
      }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on, disabled: locked }}
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        minHeight: 44,
        paddingLeft: 16,
        paddingRight: 12,
        backgroundColor: pressed ? t.pressed : "transparent",
      })}
    >
      <Icon size={17} strokeWidth={2.1} color={on && !locked ? t.accent : t.faint} />
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={1.3}
        style={{ flex: 1, fontSize: 15, fontWeight: on ? "600" : "500", color: tone }}
      >
        {label}
      </Text>
      {locked ? (
        <Lock size={14} strokeWidth={2.2} color={t.faint} />
      ) : on ? (
        <Check size={18} strokeWidth={2.6} color={t.accent} />
      ) : null}
    </Pressable>
  );
}
