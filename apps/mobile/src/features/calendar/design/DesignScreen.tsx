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
  useSetSituationColor,
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

  const recordOn = (id: string) => recordBlocks.includes(id as BookingBlockId);
  const eventOn = (id: string) => eventBlocks.includes(id as EventBlockId);

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Дизайн" />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        {/* ── ЦВЕТ ЗАПИСИ — В ПОРЯДКЕ ПРАВИЛА (владелец 24.09: «как правильно
            работают цвета — надо правильно донести до пользователя»). Карточка
            читается сверху вниз ровно так, как календарь выбирает цвет:
            1) чего не хватает — этим цветом, пока не заполнят;
            2) всё заполнено — цветом команды / метки / услуги;
            3) у источника цвета нет — запасным.
            Над всем — цвет, выбранный в самой записи (подпись под карточкой). */}
        <SectionCard title="Цвет записи" padded>
          {situations.length > 0 ? (
            <>
              <StepLabel text="Пока в записи не хватает" first />
              <View style={{ flexDirection: "row", gap: 6 }}>
                {situations.map((s) => {
                  const hue = palette[s.id] ?? null;
                  return (
                    <ColorTile
                      key={s.id}
                      // Ровно две строки у каждого («Нет / клиента»).
                      title={s.label.replace(" ", "\n")}
                      // Цвет виден самим образцом; словами — только отказ.
                      sub={hue ? undefined : "Не красить"}
                      a11yColor={hue ? colorName(hue) : "не красить"}
                      hue={hue}
                      height={64}
                      onPress={() => openColor(s.id)}
                    />
                  );
                })}
              </View>
            </>
          ) : null}
          <StepLabel text="Когда всё заполнено" first={situations.length === 0} />
          <View style={{ flexDirection: "row", gap: 6 }}>
            <View style={{ flex: 2, minWidth: 0 }}>
              <ColorTile
                title={AUTO_COLOR_RULES.find((r) => r.id === rule)?.label ?? "Цвет команды"}
                hue={ordinary}
                height={64}
                onPress={() => {
                  haptics.tap();
                  setRuleOpen(true);
                }}
              />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <ColorTile
                title={"Если нет\nцвета"}
                a11yColor={colorName(fallback)}
                hue={fallback}
                height={64}
                onPress={() => openColor("fallback")}
              />
            </View>
          </View>
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
              {BOOKING_BLOCKS.map((block) => (
                <BlockCell
                  key={block.id}
                  label={block.label}
                  icon={BLOCK_ICON[block.id] ?? Bookmark}
                  on={block.pinned ? true : recordOn(block.id)}
                  locked={!!block.pinned}
                  onToggle={() => toggleRecordBlock.mutate(block.id)}
                />
              ))}
            </View>
            <View style={{ width: 1, backgroundColor: t.separator }} />
            <View style={{ flex: 1 }}>
              <ColumnTitle text="Событие" />
              {EVENT_BLOCKS.map((block) => {
                // Объекта события нет, пока у компании выключены объекты.
                const noObjects = block.id === "object" && !objectsOn;
                return (
                  <BlockCell
                    key={block.id}
                    label={block.label}
                    icon={BLOCK_ICON[block.id] ?? Bookmark}
                    on={block.pinned ? true : !noObjects && eventOn(block.id)}
                    locked={!!block.pinned || noObjects}
                    onToggle={() => toggleEventBlock.mutate(block.id)}
                  />
                );
              })}
            </View>
          </View>
        </SectionCard>
        <RowCaption text="Выключенный блок пропадает у всей компании. Данные остаются." />

        {/* ── ТИПЫ СОБЫТИЙ — ДВЕРЬ, КАК У УСЛУГ И МЕТОК (владелец 24.09:
            «отдельной страницей, как и везде»). Все типы и так стоят в
            «Быстром событии» — отдельно это не объясняется. */}
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
