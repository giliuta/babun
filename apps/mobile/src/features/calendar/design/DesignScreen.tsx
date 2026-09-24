import { Fragment, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import {
  Bookmark,
  Briefcase,
  CalendarRange,
  FileText,
  MapPin,
  Settings2,
  StickyNote,
  UserRound,
  Wallet,
  type LucideIcon,
} from "lucide-react-native";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Chip } from "@/components/ui/Chip";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { RecordMark, recordMarkText } from "@/components/ui/RecordMark";
import { Divider } from "@/components/ui/Divider";
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
  useSetSituationColor,
  useSituationPalette,
  useToggleBookingBlock,
  useToggleEventBlock,
  type AutoColorRule,
  type BookingBlockId,
  type EventBlockId,
} from "@/features/appointments/booking-prefs";
import { durationLabel } from "@/features/services/format";
import { EventTypeSheet } from "@/features/reference/screens/EventTypeSheet";
import { useEventTypesEditor } from "@/features/reference/screens/use-event-types-editor";

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
// БЛОКИ. Одна карточка, переключатель «Запись | Событие» и чипы — вкл. залит
// цветом, выкл. серый. Обязательные блоки не притворяются настройкой: их
// называет строка «Всегда: …».
//
// ТИПЫ СОБЫТИЙ. Строки того же вида, что в шторке «Быстрое событие»: что
// здесь, то там. Тап — правка, «Добавить» в шапке, ползунки — полный список.

type ColorTarget = ColorSituation | "fallback";
type BlockTab = "record" | "event";

const RULE_ICON: Record<AutoColorRule, LucideIcon> = {
  team: CalendarRange,
  label: Bookmark,
  service: Briefcase,
};

/** Во что красится обычная запись — словами подписи образца. */
const RULE_SUB: Record<AutoColorRule, string> = {
  team: "цвет команды",
  label: "цвет метки",
  service: "цвет услуги",
};

/** Значок блока формы — тот же, что у сущности в продукте (BLOCKS.md §0.2). */
const BLOCK_ICON: Record<string, LucideIcon> = {
  label: Bookmark,
  client: UserRound,
  object: MapPin,
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
  const [ruleOpen, setRuleOpen] = useState(false);

  // ── блоки ──
  const [blockTab, setBlockTab] = useState<BlockTab>("record");
  const recordBlocks = useBookingBlocks();
  const toggleRecordBlock = useToggleBookingBlock();
  const eventBlocks = useEventBlocks();
  const toggleEventBlock = useToggleEventBlock();
  const objectsOn = recordBlocks.includes("object");

  // ── типы событий ──
  const editor = useEventTypesEditor();

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
  const tiles: { id: ColorTarget; title: string; hue: string | null }[] = [
    ...situations.map((s) => ({
      id: s.id as ColorTarget,
      title: s.label,
      hue: palette[s.id] ?? null,
    })),
    { id: "fallback", title: "Без цвета", hue: fallback },
  ];

  const openColor = (target: ColorTarget) => {
    haptics.tap();
    setEditingColor(target);
  };

  // Блоки выбранной формы: обязательные уходят в строку «Всегда».
  const blockDefs = blockTab === "record" ? BOOKING_BLOCKS : EVENT_BLOCKS;
  const optional = blockDefs.filter((b) => !b.pinned);
  const always = blockDefs.filter((b) => b.pinned).map((b) => b.label);
  const isOn = (id: string) =>
    blockTab === "record"
      ? recordBlocks.includes(id as BookingBlockId)
      : eventBlocks.includes(id as EventBlockId);
  const toggle = (id: string) =>
    blockTab === "record"
      ? toggleRecordBlock.mutate(id as BookingBlockId)
      : toggleEventBlock.mutate(id as EventBlockId);

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Дизайн" />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        {/* ── ЦВЕТ ── */}
        <SectionCard title="Цвет" padded>
          <ColorTile
            title="Обычная запись"
            sub={RULE_SUB[rule]}
            hue={ordinary}
            height={56}
            onPress={() => {
              haptics.tap();
              setRuleOpen(true);
            }}
          />
          <View style={{ flexDirection: "row", gap: 6, marginTop: 6 }}>
            {tiles.map((tile) => (
              <ColorTile
                key={tile.id}
                // РОВНО ДВЕ СТРОКИ У КАЖДОГО («Нет / клиента», «Без / цвета»):
                // иначе «Нет услуг» вставал в одну и сетка шла вразнобой.
                title={tile.title.replace(" ", "\n")}
                // Цвет виден самим образцом; имя цвета — в палитре. Словами
                // говорит только отказ — «Не красить».
                sub={tile.hue ? undefined : "Не красить"}
                a11yColor={tile.hue ? colorName(tile.hue) : "не красить"}
                hue={tile.hue}
                height={64}
                onPress={() => openColor(tile.id)}
              />
            ))}
          </View>
        </SectionCard>

        {/* ── БЛОКИ ── */}
        <SectionCard title="Блоки" padded>
          <SegmentedControl
            options={[
              { value: "record", label: "Запись" },
              { value: "event", label: "Событие" },
            ]}
            value={blockTab}
            onChange={(next) => {
              haptics.tap();
              setBlockTab(next);
            }}
          />
          <View
            style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }}
          >
            {optional.map((block) => {
              const Icon = BLOCK_ICON[block.id] ?? Bookmark;
              // Объекта события нет, пока у компании выключены объекты.
              const locked = blockTab === "event" && block.id === "object" && !objectsOn;
              const on = !locked && isOn(block.id);
              return (
                <Chip
                  key={block.id}
                  variant="tint"
                  checkbox
                  selected={on}
                  disabled={locked}
                  label={block.label}
                  icon={
                    <Icon
                      size={16}
                      strokeWidth={2.2}
                      color={on ? t.accent : t.sub}
                    />
                  }
                  onPress={() => toggle(block.id)}
                />
              );
            })}
          </View>
          <Text
            maxFontSizeMultiplier={1.3}
            style={{ marginTop: 12, fontSize: 13, color: t.sub }}
          >
            Всегда: {always.join(", ").toLowerCase()}
          </Text>
        </SectionCard>
        <RowCaption text="Выключенный блок пропадает у всей компании. Данные остаются." />

        {/* ── ТИПЫ СОБЫТИЙ ── */}
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
              style={{ paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: t.sub }}
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
                  sub={[durationLabel(type.defaultDuration), type.hidden ? "скрыт" : null]
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
        <RowCaption text="Эти типы стоят в «Быстром событии» — долгое нажатие по свободному месту календаря." />
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
