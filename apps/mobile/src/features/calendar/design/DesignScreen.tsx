import { Fragment, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import {
  Bookmark,
  Briefcase,
  CalendarRange,
  Clock,
  FileText,
  MapPin,
  Settings2,
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
import { ControlRow, RowCaption } from "@/components/ui/card-rows";
import { RecordMark, recordMarkText } from "@/components/ui/RecordMark";
import { ToggleRow } from "@/components/ui/ToggleListScreen";
import { Divider } from "@/components/ui/Divider";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import { colorName } from "@babun/shared/common/utils/colors";
import { ColorSheet } from "@/features/appointments/BookingSheets";
import { useTeams } from "@/features/reference/queries";
import { COLOR_SITUATIONS, type ColorSituation } from "@/features/appointments/record-color";
import {
  BOOKING_BLOCKS,
  EVENT_BLOCKS,
  useAutoColorRule,
  useBookingBlocks,
  useEventBlocks,
  useFallbackColor,
  useSetAutoColorRule,
  useSetFallbackColor,
  useSetSituationColor,
  useSituationPalette,
  useToggleBookingBlock,
  useToggleEventBlock,
  type AutoColorRule,
} from "@/features/appointments/booking-prefs";
import { durationLabel } from "@/features/services/format";
import { EventTypeSheet } from "@/features/reference/screens/EventTypeSheet";
import { useEventTypesEditor } from "@/features/reference/screens/use-event-types-editor";

// «ДИЗАЙН» — ВСЁ О ТОМ, КАК ВЫГЛЯДИТ И ИЗ ЧЕГО СОСТОИТ ЗАПИСЬ, ОДНОЙ СТРАНИЦЕЙ
// (владелец 2026-09-24: «оформить в одну страницу, не разбивать на кучу
// тапов по лишним страницам; назвать не „запись“, а „дизайн“; выбор блоков в
// записи, выбор блоков в событиях, какой цвет изначально и как он меняется
// автоматически»).
//
// Было четыре экрана: развилка «Запись» → «Страница записи» / «Страница
// события» → «Блоки формы» и «Типы событий». Теперь одна прокрутка, и
// читается она тем же порядком, которым работает календарь:
//   1. КАК ВЫГЛЯДИТ — настоящие блоки сетки на каждый случай правила;
//   2. ЦВЕТ ЗАПИСИ — откуда берётся обычный цвет и чем красить без цвета;
//   3. АВТОМАТИЧЕСКИ — цвет, которым запись говорит, чего в ней не хватает;
//   4. БЛОКИ ЗАПИСИ и БЛОКИ СОБЫТИЯ — из чего состоят формы;
//   5. ТИПЫ СОБЫТИЙ — справочник, из которого строится «Быстрое событие».
// Каждый выбор ставится одним тапом прямо здесь; шторка открывается только
// там, где выбирают из палитры.

type ColorTarget = ColorSituation | "fallback";

const RULE_OPTIONS = [
  { value: "team", label: "Команда" },
  { value: "label", label: "Метка" },
  { value: "service", label: "Услуга" },
] as const satisfies readonly { value: AutoColorRule; label: string }[];

/** Значок блока формы — тот же, что у сущности в продукте (BLOCKS.md §0.2). */
const BLOCK_ICON: Record<string, LucideIcon> = {
  team: CalendarRange,
  type: Tags,
  label: Bookmark,
  when: Clock,
  client: UserRound,
  object: MapPin,
  services: Briefcase,
  payment: Wallet,
  note: StickyNote,
  files: FileText,
};

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

  // ── блоки ──
  const recordBlocks = useBookingBlocks();
  const toggleRecordBlock = useToggleBookingBlock();
  const eventBlocks = useEventBlocks();
  const toggleEventBlock = useToggleEventBlock();

  // ── типы событий ──
  const editor = useEventTypesEditor();

  // Ситуация про выключенный блок не показывается: у бьюти-мастера объекта нет
  // вовсе, и «нет объекта» для него не дыра, а норма.
  const situations = COLOR_SITUATIONS.filter(
    (s) => s.id !== "noObject" || recordBlocks.includes("object"),
  );

  // «ОБЫЧНАЯ» В ЛЕГЕНДЕ — ЦВЕТОМ ПЕРВОЙ КОМАНДЫ: любое из трёх правил падает
  // на цвет команды, когда своего цвета нет, а без команд красит запасной.
  const { data: teams = [] } = useTeams();
  const ordinary = teams[0]?.color || fallback;
  const legend = [
    { id: "ordinary", title: "Обычная", color: ordinary },
    ...situations.map((s) => ({
      id: s.id,
      title: s.label,
      color: palette[s.id] ?? ordinary,
    })),
  ];

  const colorOf = (target: ColorTarget) =>
    target === "fallback" ? fallback : palette[target] ?? null;

  const openColor = (target: ColorTarget) => {
    haptics.tap();
    setEditingColor(target);
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Дизайн" />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        {/* 1. ЛЕГЕНДА — НАСТОЯЩИЕ БЛОКИ КАЛЕНДАРЯ (общий `RecordMark`: та же
            заливка, контур, блик), поэтому разойтись с сеткой не могут. */}
        <SectionCard title="Как выглядит" padded>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {legend.map((item) => (
              <View key={item.id} style={{ flex: 1, minWidth: 0 }}>
                <RecordMark hue={item.color} full size={58}>
                  <Text
                    numberOfLines={2}
                    maxFontSizeMultiplier={1.2}
                    style={{
                      fontSize: 13,
                      lineHeight: 16,
                      fontWeight: "700",
                      color: recordMarkText(item.color, t.ink),
                    }}
                  >
                    {item.title}
                  </Text>
                </RecordMark>
              </View>
            ))}
          </View>
        </SectionCard>

        {/* 2. ОТКУДА ОБЫЧНЫЙ ЦВЕТ — ответ виден сразу и ставится одним тапом
            (владелец: «варианты видны, один тап»), а не спрятан за списком. */}
        <SectionCard title="Цвет записи">
          <ControlRow label="Цвет от">
            <SegmentedControl
              compact
              options={RULE_OPTIONS}
              value={rule}
              onChange={(next) => {
                haptics.tap();
                setRule.mutate(next);
              }}
            />
          </ControlRow>
          <Divider inset={16} />
          <SettingsRow
            swatch={fallback}
            title="Если цвета нет"
            sub={colorName(fallback)}
            onPress={() => openColor("fallback")}
          />
        </SectionCard>
        <RowCaption text="Цвет, выбранный в самой записи, главнее правила." />

        {/* 3. АВТОМАТИКА — цвет отвечает на вопрос «чего не хватает» и
            перебивает обычный цвет, пока дыра не закрыта. Порядок строк — порядок
            важности: первая незакрытая сверху и красит. */}
        <SectionCard title="Автоматически">
          {situations.map((situation, i) => (
            <Fragment key={situation.id}>
              {i > 0 ? <Divider inset={56} /> : null}
              <SettingsRow
                swatch={palette[situation.id] ?? null}
                title={situation.label}
                sub={palette[situation.id] ? colorName(palette[situation.id]) : "Не красить"}
                onPress={() => openColor(situation.id)}
              />
            </Fragment>
          ))}
        </SectionCard>
        <RowCaption text="Пока в записи этого нет, она такого цвета. Верхняя строка главнее." />

        {/* 4. БЛОКИ ФОРМ — функции компании: выключенный блок пропадает у всех,
            данные не стираются. Закреплённые стоят «всегда» — владелец 06.09
            просил видеть весь состав страницы. */}
        <SectionCard title="Блоки записи">
          {BOOKING_BLOCKS.map((block, i) => (
            <Fragment key={block.id}>
              {i > 0 ? <Divider inset={56} /> : null}
              <ToggleRow
                item={{
                  id: block.id,
                  label: block.label,
                  icon: BLOCK_ICON[block.id] ?? Tags,
                  color: t.accent,
                  checked: block.pinned ? true : recordBlocks.includes(block.id),
                  locked: block.pinned,
                  lockedNote: block.pinned ? "всегда" : undefined,
                  onToggle: () => toggleRecordBlock.mutate(block.id),
                }}
              />
            </Fragment>
          ))}
        </SectionCard>

        <SectionCard title="Блоки события">
          {EVENT_BLOCKS.map((block, i) => (
            <Fragment key={block.id}>
              {i > 0 ? <Divider inset={56} /> : null}
              <ToggleRow
                item={{
                  id: block.id,
                  label: block.label,
                  icon: BLOCK_ICON[block.id] ?? Tags,
                  color: t.accent,
                  checked: block.pinned ? true : eventBlocks.includes(block.id),
                  // Объекта события нет, пока у компании выключены объекты.
                  locked:
                    block.pinned ||
                    (block.id === "object" && !recordBlocks.includes("object")),
                  lockedNote: block.pinned
                    ? "всегда"
                    : block.id === "object" && !recordBlocks.includes("object")
                      ? "объекты выключены"
                      : undefined,
                  onToggle: () => toggleEventBlock.mutate(block.id),
                }}
              />
            </Fragment>
          ))}
        </SectionCard>
        <RowCaption text="Выключенный блок пропадает у всей компании. Данные остаются." />

        {/* 5. ТИПЫ СОБЫТИЙ — прямо здесь: тап правит, «Добавить» в шапке
            заводит. Порядок, скрытие и удаление — за ползунками в шапке, на
            полном списке. */}
        <SectionCard
          title="Типы событий"
          action={[
            {
              label: "Порядок, скрыть и удалить",
              icon: Settings2,
              onPress: () => {
                haptics.tap();
                router.push("/calendar/event-types" as Href);
              },
            },
            {
              label: "Добавить",
              onPress: () => {
                haptics.tap();
                editor.setEditing({ mode: "create" });
              },
            },
          ]}
        >
          {editor.types.length === 0 ? (
            <Text
              maxFontSizeMultiplier={1.3}
              style={{
                paddingHorizontal: 16,
                paddingVertical: 14,
                fontSize: 15,
                color: t.sub,
              }}
            >
              {editor.typesQuery.isLoading ? " " : "Типов пока нет"}
            </Text>
          ) : (
            editor.types.map((type, i) => (
              <Fragment key={type.id}>
                {i > 0 ? <Divider inset={56} /> : null}
                <SettingsRow
                  appearance={{ color: type.color, icon: type.icon }}
                  title={type.label}
                  sub={[
                    durationLabel(type.defaultDuration),
                    type.hidden ? "скрыт" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  onPress={() => {
                    haptics.tap();
                    editor.setEditing({ mode: "edit", type });
                  }}
                />
              </Fragment>
            ))
          )}
        </SectionCard>
        <RowCaption text="Типы стоят в «Быстром событии» — долгое нажатие по свободному месту календаря." />
      </ScrollView>

      <ColorSheet
        visible={editingColor != null}
        onClose={() => setEditingColor(null)}
        title={
          editingColor === "fallback"
            ? "Если цвета нет"
            : COLOR_SITUATIONS.find((s) => s.id === editingColor)?.label
        }
        // «Не красить» вместо «Автоматически»: у ситуации нет автомата — есть
        // отказ от сигнала, и тогда красит следующее правило. У запасного
        // цвета отказаться нельзя: он последняя ступень.
        autoLabel="Не красить"
        allowNone={editingColor !== "fallback"}
        // Тап по цвету и есть сохранение — кнопки «Применить» у одиночного
        // выбора нет (канон 5.2).
        commitOnPick
        value={editingColor ? colorOf(editingColor) : null}
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

      <EventTypeSheet
        visible={editor.editing !== null}
        type={editor.editing?.mode === "edit" ? editor.editing.type : null}
        busy={editor.save.isPending}
        onClose={() => editor.setEditing(null)}
        onSubmit={editor.submit}
      />
    </Screen>
  );
}
