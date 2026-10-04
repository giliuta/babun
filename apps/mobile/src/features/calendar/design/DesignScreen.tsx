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
  Clock,
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
import { SwitchRow } from "@/components/ui/SwitchRow";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { GUTTER } from "@/components/ui/tokens";
import { RecordMark } from "@/components/ui/RecordMark";
import { RowCaption } from "@/components/ui/card-rows";
import { AlwaysLine, BlockCell } from "@/components/ui/block-toggles";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { haptics } from "@/lib/haptics";
import { notify } from "@/lib/notify";
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
import { useCalendarSettings, usePersonalEventTypes } from "@/features/settings/local-settings";
import { useDataRole, usePlanAllows } from "@/features/settings/tenant";
import { useTariffNudge } from "@/features/tariffs/use-tariff";
import { useMemberUpdateTeam } from "@/features/calendar/mutations";
import { useTeamSettingLevel } from "@/features/calendar/team-setting-level";

// «ЗАПИСИ» (до 30.09 — «Дизайн») — КАК ВЫГЛЯДИТ И ИЗ ЧЕГО СОСТОИТ ЗАПИСЬ.
// ТРИ КАРТОЧКИ, ВСЁ ТАПОМ. Владелец 30.09: «дизайн переименуем в записи
// клиентов или как-то так» — «Записи», потому что на странице и клиенты, и
// события («Клиент | Событие»).
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
  // «ТОЛЬКО ВИДИТ» — СТРАНИЦА БЕЗ ПРАВКИ (владелец 30.09: «Записи» в
  // «Настройках команды»). Владельцу — всегда правка.
  const readOnly = useTeamSettingLevel("calendar.booking_form", teamId) !== "write";
  // Строку команды (её цвет, «Скрывать отменённые») сотрудник пишет своей
  // дверью `member_update_team` — по тому же праву «Записи».
  const isMaster = useDataRole().data === "master";
  const memberUpdateTeam = useMemberUpdateTeam();

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

  // «СКРЫВАТЬ ОТМЕНЁННЫЕ» — ЗДЕСЬ, НА «КЛИЕНТЕ» (владелец 30.09: «скрывать
  // отменённые закинем именно в блок клиентов»; раньше — последний тумблер
  // шестерёнки). Пишется в КОМАНДУ (`teams.hide_cancelled`), как всё на этой
  // странице: календарь и так читает сперва её, а старое значение компании
  // (`calendar_settings`) — только пока у команды своего нет. Тумблер ставит
  // явное да/нет, не `null`: «как у компании» отсюда уже не выбрать.
  const companyHides = !!useCalendarSettings().data?.hideCancelled;
  const [hidesNow, setHidesNow] = useState<boolean | null>(null);
  const hidesCancelled = hidesNow ?? team?.hide_cancelled ?? companyHides;
  const setHidesCancelled = (next: boolean) => {
    if (!team || readOnly) return;
    haptics.tap();
    setHidesNow(next);
    const done = {
      onSettled: () => setHidesNow(null),
      onError: (e: Error) => notify("Ошибка", e.message),
    };
    if (isMaster) {
      memberUpdateTeam.mutate({ teamId: team.id, patch: { hide_cancelled: next } }, done);
    } else {
      updateTeam.mutate({ id: team.id, patch: { hide_cancelled: next } }, done);
    }
  };

  // ПОДСВЕТКА — ТОЛЬКО У ВКЛЮЧЁННОГО БЛОКА (владелец 25.09: «убираю объект —
  // подсветка уходит; то же с оплатой; тогда запись считается заполненной»).
  const situations = COLOR_SITUATIONS.filter((s) =>
    s.id === "noObject" ? objectsOn : recordBlocks.includes("payment"),
  );
  // ПЕРЕКЛЮЧАТЕЛЬ СТРАНИЦЫ (владелец 25.09): «Клиент» — цвет записи и её
  // блоки, «Событие» — блоки события и типы; открывается «Клиент».
  //
  // БЕЗ ТАРИФА КЛИЕНТОВ НЕТ (владелец 04.10: «если нет тарифа, открывает
  // сразу события, а клиента не может открыть»): «Клиент» серый, тап — плашка
  // тарифа; страница стоит на «Событии».
  const clientsInPlan = usePlanAllows("book-clients");
  const nudgeTariff = useTariffNudge();
  const [pickedTab, setTab] = useState<"record" | "event" | null>(null);
  const tab = clientsInPlan ? (pickedTab ?? "record") : "event";
  const openColor = (target: ColorTarget) => {
    if (readOnly) return;
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
      <ScreenHeader title="Записи" subtitle={team?.name} />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        {/* ПЕРЕКЛЮЧАТЕЛЬ «КЛИЕНТ | СОБЫТИЕ» — НАВЕРХУ И НА ВСЮ СТРАНИЦУ
            (владелец 25.09: «выбираю клиенты — настраиваю всё по клиентам,
            события — всё по событиям»). */}
        <View style={{ paddingHorizontal: GUTTER, paddingTop: 8, paddingBottom: 4 }}>
          <SegmentedControl
            options={[
              { value: "record", label: "Клиент", dimmed: !clientsInPlan },
              { value: "event", label: "Событие" },
            ]}
            value={tab}
            onChange={(next) => {
              if (next === "record" && !clientsInPlan) {
                nudgeTariff();
                return;
              }
              setTab(next);
            }}
          />
        </View>

        {tab === "record" ? (
          <>

            {/* ОБЯЗАТЕЛЬНЫЕ — ОДНОЙ СТРОКОЙ СВЕРХУ (29.09): строки с замком
                растягивали список и спорили с теми, что правда выключаются. */}
            <SectionCard title="Блоки записи">
              <AlwaysLine blocks={BOOKING_BLOCKS} />
              {BOOKING_BLOCKS.filter((b) => !b.pinned).map((block) => (
                <BlockCell
                  key={block.id}
                  label={block.label}
                  icon={BLOCK_ICON[block.id] ?? Bookmark}
                  on={recordOn(block.id)}
                  locked={false}
                  readOnly={readOnly}
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
                  onPress={readOnly ? undefined : () => openColor(row.id)}
                />
              ))}
            </SectionCard>
            <RowCaption text="Цвет, выбранный в самой записи, главнее." />

            <SectionCard className="mt-4">
              <SwitchRow
                label="Скрывать отменённые"
                value={hidesCancelled}
                onChange={setHidesCancelled}
                disabled={readOnly}
              />
            </SectionCard>
          </>
        ) : (
          <>
            <SectionCard title="Блоки события">
              <AlwaysLine blocks={EVENT_BLOCKS} />
              {EVENT_BLOCKS.filter((b) => !b.pinned).map((block) => {
                // Объекта события нет, пока у команды выключены объекты.
                // Без тарифа нет клиентов, а объект — всегда объект клиента:
                // обе строки сняты и не ставятся (владелец 04.10).
                const noObjects = block.id === "object" && !objectsOn;
                const noPlan = !clientsInPlan && (block.id === "client" || block.id === "object");
                const locked = noObjects || noPlan;
                return (
                  <BlockCell
                    key={block.id}
                    label={block.label}
                    icon={BLOCK_ICON[block.id] ?? Bookmark}
                    on={!locked && eventOn(block.id)}
                    locked={locked}
                    readOnly={readOnly}
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
              if (isMaster) {
                memberUpdateTeam.mutate(
                  { teamId: team.id, patch: { color } },
                  { onError: (e) => notify("Ошибка", e.message) },
                );
              } else {
                updateTeam.mutate({ id: team.id, patch: { color } });
              }
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
  /** Нет — «Только видит»: строка показывает цвет, без двери. */
  onPress?: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : "text"}
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
      {onPress ? <ChevronRight size={18} color={t.faint} strokeWidth={2.2} /> : null}
    </Pressable>
  );
}
