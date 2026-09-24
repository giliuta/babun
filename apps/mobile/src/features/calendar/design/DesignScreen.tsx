import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import {
  Bookmark,
  ChevronRight,
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
import { GUTTER } from "@/components/ui/tokens";
import { RecordMark } from "@/components/ui/RecordMark";
import { RowCaption } from "@/components/ui/card-rows";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import { ColorSheet } from "@/features/appointments/BookingSheets";
import { useTeams, useUpdateTeam } from "@/features/reference/queries";
import { COLOR_SITUATIONS, type ColorSituation } from "@/features/appointments/record-color";
import {
  BOOKING_BLOCKS,
  EVENT_BLOCKS,
  useAutoColorRule,
  useBookingBlocks,
  useEventBlocks,
  useFallbackColor,
  useSetAutoColorRule,
  useSetSituationColor,
  useSituationPalette,
  useToggleBookingBlock,
  useToggleEventBlock,
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

type ColorTarget = ColorSituation | "filled";



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
  // «ДИЗАЙН» — У КАЖДОЙ КОМАНДЫ СВОЙ (владелец 24.09). Команда едет адресом из
  // настроек календаря; без неё — первая.
  const params = useLocalSearchParams<{ team?: string }>();
  const { data: allTeams = [] } = useTeams();
  const team = allTeams.find((x) => x.id === params.team) ?? allTeams[0];
  const teamId = team?.id ?? null;

  // ── цвет ──
  const rule = useAutoColorRule(teamId);
  const setRule = useSetAutoColorRule(teamId);
  const palette = useSituationPalette(teamId);
  const setSituationColor = useSetSituationColor(teamId);
  const fallback = useFallbackColor(teamId);
  const [editingColor, setEditingColor] = useState<ColorTarget | null>(null);

  // ── блоки ──
  const recordBlocks = useBookingBlocks(teamId);
  const toggleRecordBlock = useToggleBookingBlock(teamId);
  const eventBlocks = useEventBlocks(teamId);
  const toggleEventBlock = useToggleEventBlock(teamId);
  const objectsOn = recordBlocks.includes("object");

  // ── типы событий ──
  const typesQuery = usePersonalEventTypes(teamId);
  const liveTypes = (typesQuery.data ?? []).filter((type) => !type.hidden);
  // Подпись двери — имена типов, как у «Меток»; пока грузится — пусто.
  const typesSub = typesQuery.isLoading
    ? undefined
    : liveTypes.length === 0
      ? "Типов пока нет"
      : liveTypes.map((type) => type.label).join(", ");

  // ВСЁ ЗАПОЛНЕНО — ЦВЕТОМ КОМАНДЫ (владелец 25.09: «убери „красить по“ —
  // просто выбор самого цвета, в какой красить, когда всё заполнено»).
  // Выбор здесь и есть цвет команды: так он один на сетку, ленту команд и
  // её записи.
  const teams = allTeams;
  const ordinary = team?.color || fallback;
  const updateTeam = useUpdateTeam();

  // ПОДСВЕТКА — ТОЛЬКО У ВКЛЮЧЁННОГО БЛОКА (владелец 25.09: «убираю объект —
  // подсветка уходит; то же с оплатой; тогда запись считается заполненной»).
  const situations = COLOR_SITUATIONS.filter((s) =>
    s.id === "noObject" ? objectsOn : recordBlocks.includes("payment"),
  );
  // ПЕРЕКЛЮЧАТЕЛЬ СТРАНИЦЫ (владелец 25.09): «Клиент» — цвет записи и её
  // блоки, «Событие» — блоки события и типы; открывается «Клиент».
  const [tab, setTab] = useState<"record" | "event">("record");
  const openColor = (target: ColorTarget) => {
    haptics.tap();
    setEditingColor(target);
  };


  // СТРОКИ ЦВЕТА (владелец 25.09: «нормально — всё заполнено, справа
  // выбираешь цвет, и всё, или вообще без цвета»). Первая — обычный цвет,
  // за ней по строке на каждый включённый блок, который подсвечивается.
  // У КАЖДОЙ СТРОКИ — КОГДА ОНА СРАБАТЫВАЕТ (владелец 25.09: «как человеку
  // понять, что значит „всё заполнено“»). Не имя цвета — его говорит образец.
  const SIT_WHEN: Record<string, string> = {
    unpaid: "Визит прошёл, а оплаты нет",
    noObject: "У записи не выбран объект",
  };
  const colorRows: {
    id: ColorTarget;
    title: string;
    when: string;
    hue: string | null;
  }[] = [
    { id: "filled", title: "Обычный цвет", when: "Когда с записью всё в порядке", hue: ordinary },
    ...situations.map((sit) => ({
      id: sit.id as ColorTarget,
      title: sit.label,
      when: SIT_WHEN[sit.id] ?? "",
      hue: palette[sit.id] ?? null,
    })),
  ];

  const recordOn = (id: string) => recordBlocks.includes(id as BookingBlockId);
  const eventOn = (id: string) => eventBlocks.includes(id as EventBlockId);

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Дизайн" subtitle={team?.name} />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        {/* ПЕРЕКЛЮЧАТЕЛЬ «КЛИЕНТ | СОБЫТИЕ» — НАВЕРХУ И НА ВСЮ СТРАНИЦУ
            (владелец 25.09: «выбираю клиенты — настраиваю всё по клиентам,
            события — всё по событиям»). */}
        <View style={{ paddingHorizontal: GUTTER, paddingTop: 8, paddingBottom: 4 }}>
          <SegmentedControl
            options={[
              { value: "record", label: "Клиент" },
              { value: "event", label: "Событие" },
            ]}
            value={tab}
            onChange={(next) => {
              haptics.tap();
              setTab(next);
            }}
          />
        </View>

        {tab === "record" ? (
          <>

            <SectionCard title="Блоки записи">
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
            </SectionCard>
            <RowCaption text="Выключенный блок пропадает у всей команды. Данные остаются." />

            {/* ЦВЕТ ЗАПИСИ — ПОД БЛОКАМИ, ОБЫЧНЫМИ СТРОКАМИ: слева случай,
                справа его цвет (или «Без цвета»), тап — палитра. */}
            <SectionCard title="Цвет записи">
              {colorRows.map((row, i) => (
                <ColorRow
                  key={row.id}
                  title={row.title}
                  when={row.when}
                  hue={row.hue}
                  separated={i > 0}
                  onPress={() => openColor(row.id)}
                />
              ))}
            </SectionCard>
            <RowCaption text="Цвет, выбранный в самой записи, главнее." />
          </>
        ) : (
          <>
            <SectionCard title="Блоки события">
              {EVENT_BLOCKS.map((block) => {
                // Объекта события нет, пока у команды выключены объекты.
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
            </SectionCard>
            <RowCaption text="Выключенный блок пропадает у всей команды. Данные остаются." />

            {/* ТИПЫ СОБЫТИЙ — дверь на свою страницу, как у услуг и меток. */}
            {eventOn("type") ? (
              <SectionCard>
                <SettingsRow
                  tile={SETTINGS_TILE.purple}
                  icon={Tags}
                  title="Типы событий"
                  sub={typesSub}
                  onPress={() => {
                    haptics.tap();
                    router.push({
                      pathname: "/calendar/event-types",
                      params: teamId ? { team: teamId } : {},
                    } as Href);
                  }}
                />
              </SectionCard>
            ) : null}
          </>
        )}
      </ScrollView>


      <ColorSheet
        visible={editingColor != null}
        onClose={() => setEditingColor(null)}
        title={
          editingColor === "filled"
            ? "Обычный цвет"
            : COLOR_SITUATIONS.find((s) => s.id === editingColor)?.label
        }
        // «Не красить»: у случая нет автомата — есть отказ от сигнала, и
        // тогда запись красится как обычная. У «Без цвета» отказа нет: это
        // последняя ступень.
        autoLabel="Не красить"
        autoColor={ordinary}
        allowNone={editingColor !== "filled"}
        commitOnPick
        value={
          editingColor === "filled"
            ? ordinary
            : editingColor
              ? palette[editingColor] ?? null
              : null
        }
        onPick={(color) => {
          if (!editingColor) return;
          if (editingColor === "filled") {
            if (color && team) {
              updateTeam.mutate({ id: team.id, patch: { color } });
              // Записи красятся цветом команды — правило ставим на неё.
              if (rule !== "team") setRule.mutate("team");
            }
          } else {
            setSituationColor.mutate({ situation: editingColor, color });
          }
          setEditingColor(null);
        }}
      />

    </Screen>
  );
}

/** СТРОКА ЦВЕТА — КУСОЧЕК КАЛЕНДАРЯ И ПРАВИЛО. Слева образец блока записи
 *  (`RecordMark`, тот же рецепт, что на сетке: плотная заливка, контур, блик)
 *  — так запись и ляжет в календарь. Справа случай и одной
 *  строкой, когда он срабатывает. `hue = null` — «Без цвета»: пустой контур,
 *  такая запись красится обычным цветом. */
function ColorRow({
  title,
  when,
  hue,
  separated,
  onPress,
}: {
  title: string;
  when: string;
  hue: string | null;
  separated: boolean;
  onPress: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${when}${hue ? "" : ". Без цвета"}`}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        minHeight: 68,
        paddingLeft: 16,
        paddingRight: 12,
        paddingVertical: 10,
        borderTopWidth: separated ? 1 : 0,
        borderTopColor: t.separator,
        backgroundColor: pressed ? t.pressed : "transparent",
      })}
    >
      <RecordMark hue={hue} size={40} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={1.3}
          style={{ fontSize: 16, fontWeight: "600", color: t.ink }}
        >
          {title}
        </Text>
        <Text
          numberOfLines={2}
          maxFontSizeMultiplier={1.3}
          style={{ fontSize: 13, color: t.sub, marginTop: 2 }}
        >
          {hue ? when : `${when} · без цвета`}
        </Text>
      </View>
      <ChevronRight size={18} color={t.faint} strokeWidth={2.2} />
    </Pressable>
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
