import { type ReactNode, type RefObject } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  type TextInput,
} from "react-native";
import { CalendarRange, Check, ChevronRight, MoreHorizontal, UserRound } from "lucide-react-native";

import { FieldRow, NavRow } from "@/components/ui/card-rows";
import { ChooseRow } from "@/components/ui/ChooseRow";
import { NameColorField } from "@/components/ui/picker-fields";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SelectRow } from "@/components/ui/select-rows";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { AppearanceTile } from "@/components/ui/AppearanceSheet";
import { ICON, TYPE } from "@/components/ui/tokens";
import type { Team } from "@/features/reference/queries";
import { useThemeColors } from "@/theme/colors";

import { AREA_TITLE } from "../access-map";
import {
  calendarsBlockMode,
  levelTone,
  type AreaLevel,
  type RightsArea,
} from "./master-draft";
import { RIGHTS_AREAS, levelWord } from "./rights-rows";

// КАРТОЧКА МАСТЕРА — ОДНО ТЕЛО НА ТРИ СЛУЧАЯ (владелец 15.09: «„Добавить
// мастера" — сразу полная страница мастера, как добавление клиента; красиво,
// компактно, удобно»). Новый мастер, ждущее приглашение и сотрудник рисуются
// этим телом; что правится и куда пишется, решает вызывающий режим.
//
// Все блоки — `SectionCard`. Подсказка называет поле («Имя», «Почта»), слов
// «Обязательно» нет: чего не хватает, показывают ✓ и серая кнопка. Цвет — не
// строка «Цвет», а плитка у имени, общий блок «Вид» (AGENTS 5.3). Права — не
// сводка, а четыре раздела одним словом каждый.

type Theme = ReturnType<typeof useThemeColors>;

/** Цвет слова положения — на карточке и на странице прав один: скрытое тише
 *  всего, «смотрит» вполголоса, открытое и разное — полным цветом. */
export function levelColor(t: Theme, level: AreaLevel): string {
  const tone = levelTone(level);
  return tone === "faint" ? t.faint : tone === "sub" ? t.sub : t.ink;
}

/** ⋯ в шапке карточки — действия, которых нет в её содержимом. */
export function HeaderMenuButton({ label, onPress }: { label: string; onPress: () => void }) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        height: 44,
        width: 44,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: t.radius.pill,
        backgroundColor: pressed ? t.pressed : "transparent",
      })}
    >
      <MoreHorizontal color={t.body} size={ICON.md} />
    </Pressable>
  );
}

export interface MasterIdentity {
  name: string;
  email: string;
  phone: string;
  title: string;
  color: string | null;
}

export type EmailState = "plain" | "valid" | "invalid";

type InputRef = RefObject<TextInput | null>;

export interface MasterCardViewProps {
  title: string;
  subtitle?: string;
  onBack: () => void;
  headerRight?: ReactNode;
  identity: MasterIdentity;
  /** Черновик пишет на каждый символ; приглашение и сотрудник — по уходу из
   *  поля, одним запросом на правку. */
  live: boolean;
  /** Имя, цвет, телефон и должность правятся. У сотрудника без карточки
   *  мастера писать их некуда — строки только показываются. */
  editable: boolean;
  /** Должность и цвет правятся здесь. Нет — у приглашения по существующей
   *  карточке (они живут в самой карточке) и у диспетчера (карточки нет):
   *  плитка только показывает цвет, пустая должность не рисуется. Без пропа —
   *  как `editable`. */
  cardFieldsEditable?: boolean;
  /** Почта правится только до «Пригласить»: потом это адрес приглашения. */
  emailEditable: boolean;
  /** Строки почты нет — у мастера без аккаунта её нет вовсе. */
  hideEmail?: boolean;
  autoFocusName?: boolean;
  emailState: EmailState;
  refs?: { name: InputRef; email: InputRef; phone: InputRef };
  onNameChange?: (value: string) => void;
  onNameCommit?: () => void;
  onColorChange?: (hex: string) => void;
  onEmailChange?: (value: string) => void;
  onEmailEditEnd?: () => void;
  onPhoneChange?: (value: string) => void;
  onPhoneEditEnd?: () => void;
  onTitleChange?: (value: string) => void;
  teams: readonly Team[];
  teamIds: readonly string[];
  /** Нет — календари только показываются. */
  onOpenCalendars?: () => void;
  /** Показывать ли блок календарей. У НОВОГО мастера его нет: календарь
   *  задан тем, из которого нажали «Добавить мастера», и выбирать нечего
   *  (владелец 21.09: «календарь будет уже зафиксирован»). */
  showCalendars?: boolean;
  /** `null` — реестр прав ещё едет: строки разделов стоят без слова. */
  areaLevels: Record<RightsArea, AreaLevel> | null;
  /** Разделы, у которых есть хоть один живой блок. Пусто — раздела нет на
   *  карточке: строка «Календарь — Скрыт» у мастера означала бы настройку,
   *  которой сервер не держит (STORY-083). */
  liveAreas?: readonly RightsArea[];
  onOpenArea: (area: RightsArea) => void;
  footer?: ReactNode;
  /** ПРАВА КАЛЕНДАРЯ СТРОКОЙ (STORY-087; владелец 23.09: «в одном календаре у
   *  него свои доступы, в другом — другие»). Есть — каждый календарь стоит
   *  строкой со СВОИМИ правами («Записи: меняет · Деньги: не видит»), тап
   *  открывает права этого календаря, а в блоке «Права» остаются только
   *  права компании. */
  calendarLine?: (teamId: string) => string;
  /** Слово строки раздела вместо «Частично» — например, «Меняет · свои». */
  areaValues?: Partial<Record<RightsArea, string>>;
  onOpenCalendarRights?: (teamId: string) => void;
  /** Свайп по календарю — открепить. Нет — свайпа нет. */
  onDetachCalendar?: (teamId: string) => void;
  /** Кнопка в хвосте номера — «Связаться». */
  phoneAction?: ReactNode;
  /** Блоки ниже прав: «Работа», «Личное». */
  children?: ReactNode;
}

const noop = () => {};

export function MasterCardView(p: MasterCardViewProps) {
  const t = useThemeColors();
  const areas = p.liveAreas ?? RIGHTS_AREAS;
  // Календарные разделы живут в строках календарей — в «Правах» остаются
  // разделы, у которых есть права компании (клиенты).
  const shownAreas = p.calendarLine
    ? areas.filter((area) => area !== "calendar" && area !== "finance")
    : areas;
  const check = <Check color={t.success} size={18} strokeWidth={2.5} />;
  const chosen = p.teamIds
    .map((id) => p.teams.find((team) => team.id === id))
    .filter((team): team is Team => team !== undefined);
  const anyUnchosen = p.teams.some((team) => !p.teamIds.includes(team.id));
  const danger = p.emailState === "invalid" ? t.danger : undefined;
  const openCalendars = p.onOpenCalendars;
  const calendarsMode = calendarsBlockMode(chosen.length, openCalendars !== undefined);
  const cardFields = p.editable && (p.cardFieldsEditable ?? true);

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title={p.title} subtitle={p.subtitle} onBack={p.onBack} right={p.headerRight} />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 32 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          {/* ЛИЧНОСТЬ — БЕЗЫМЯННОЙ КАРТОЧКОЙ, КАК У КЛИЕНТА. Плитка у имени —
              цвет мастера: так он узнаётся в списке и в записях. */}
          {/* У КАЖДОГО БЛОКА ШАПКА — как у клиента (владелец 22.09: первый блок
              тоже с именем). */}
          <SectionCard title="Сотрудник" padded={false}>
            {p.editable ? (
              <NameColorField
                bare
                // Плотно, как блок «Клиент» (44pt строки под именем).
                minHeight={52}
                colorReadOnly={!cardFields}
                label={null}
                name={p.identity.name}
                color={p.identity.color}
                onNameChange={p.onNameChange ?? noop}
                onColorChange={p.onColorChange ?? noop}
                onBlur={p.onNameCommit}
                fallback={UserRound}
                placeholder="Имя"
                autoCapitalize="words"
                autoFocus={p.autoFocusName}
                inputRef={p.refs?.name}
                // Галочка — подсказка черновика «имя есть»; у живого
                // сотрудника она ничего не говорит.
                trailing={p.live && p.identity.name.trim() ? check : null}
              />
            ) : (
              <FieldRow
                stacked
                hideLabel
                readOnly
                big
                label="Имя"
                placeholder="Имя"
                value={p.identity.name}
                onSave={noop}
              />
            )}
            {p.hideEmail ? null : (
            <FieldRow
              compact
              stacked
              hideLabel
              separated
              label="Почта"
              placeholder="Почта"
              value={p.identity.email}
              live={p.emailEditable}
              readOnly={!p.emailEditable}
              keyboardType="email-address"
              autoCapitalize="none"
              inputRef={p.refs?.email}
              inputColor={danger}
              valueColor={danger}
              trailing={p.emailState === "valid" ? check : null}
              onEditEnd={p.onEmailEditEnd}
              onSave={p.onEmailChange ?? noop}
            />
            )}
            {/* Пустое, которое нельзя заполнить, не показываем: строка без
                значения и без правки читалась бы сломанным полем. */}
            {p.editable || p.identity.phone ? (
              <FieldRow
              compact
                stacked
                hideLabel
                separated
                tabular
                label="Телефон"
                placeholder="Телефон"
                value={p.identity.phone}
                keyboardType="phone-pad"
                live={p.live && p.editable}
                readOnly={!p.editable}
                inputRef={p.refs?.phone}
                onEditEnd={p.onPhoneEditEnd}
                onSave={p.onPhoneChange ?? noop}
                trailing={p.identity.phone ? p.phoneAction : undefined}
              />
            ) : null}
            {cardFields || p.identity.title ? (
              <FieldRow
              compact
                stacked
                hideLabel
                separated
                label="Должность"
                placeholder="Должность"
                value={p.identity.title}
                autoCapitalize="sentences"
                live={p.live && cardFields}
                readOnly={!cardFields}
                onSave={p.onTitleChange ?? noop}
              />
            ) : null}
          </SectionCard>

          {/* КАЛЕНДАРИ — ТЕ ЖЕ СТРОКИ, ЧТО В ШТОРКЕ ВЫБОРА (реестр выбора,
              AGENTS 5.2): пусто — «Выбрать календари», выбрано — строки цвета
              календаря; первый — домашний, без отдельной метки. Где выбора
              нет (сотрудник), пусто — словами, а строки — показание без
              кнопки: мёртвых тапов на карточке нет (`calendarsBlockMode`). */}
          {p.showCalendars ? (
          <SectionCard title="Календари" padded={false}>
            {p.calendarLine && chosen.length > 0 ? (
              <>
                {chosen.map((team, i) => (
                  <CalendarRightsRow
                    key={team.id}
                    team={team}
                    line={p.calendarLine!(team.id)}
                    separated={i > 0}
                    onPress={p.onOpenCalendarRights ? () => p.onOpenCalendarRights!(team.id) : undefined}
                    onDetach={p.onDetachCalendar ? () => p.onDetachCalendar!(team.id) : undefined}
                  />
                ))}
                {openCalendars && anyUnchosen ? (
                  <ChooseRow
                    compact
                    icon={CalendarRange}
                    label="Добавить календарь"
                    onPress={openCalendars}
                  />
                ) : null}
              </>
            ) : calendarsMode === "rows-display" ? (
              // Показание без выбора (карточка без аккаунта) — теми же строками,
              // что у сотрудника: плитка цвета и имя, без мёртвой подложки.
              chosen.map((team, i) => (
                <CalendarRightsRow key={team.id} team={team} separated={i > 0} />
              ))
            ) : calendarsMode === "choose" ? (
              <ChooseRow
                icon={CalendarRange}
                label="Выбрать календари"
                onPress={openCalendars ?? noop}
              />
            ) : calendarsMode === "empty-words" ? (
              <Text
                maxFontSizeMultiplier={1.2}
                style={{ paddingHorizontal: 16, paddingVertical: 14, fontSize: 15, color: t.faint }}
              >
                Нет календарей
              </Text>
            ) : (
              <>
                <View style={{ paddingHorizontal: 8, paddingTop: 4, paddingBottom: 8, gap: 8 }}>
                  {chosen.map((team) =>
                    calendarsMode === "rows-tappable" ? (
                      <SelectRow
                        key={team.id}
                        icon={CalendarRange}
                        title={team.name}
                        color={team.color ?? undefined}
                        accessibilityHint="Открывает выбор календарей"
                        onPress={openCalendars ?? noop}
                      />
                    ) : (
                      // Доступный родитель делает строку одним элементом без
                      // роли: VoiceOver не читает её кнопкой, которой она не
                      // является.
                      <View
                        key={team.id}
                        pointerEvents="none"
                        accessible
                        accessibilityLabel={team.name}
                      >
                        <SelectRow
                          icon={CalendarRange}
                          title={team.name}
                          color={team.color ?? undefined}
                          onPress={noop}
                        />
                      </View>
                    ),
                  )}
                </View>
                {openCalendars && anyUnchosen ? (
                  // ДВЕРЬ «ДОБАВИТЬ» — НА КОЛОНКЕ ПЛИТОК ВЫШЕ: выбранные
                  // календари стоят строками шторки с отступом 8+14, а голый
                  // ChooseRow — на 16; без подложки кружок и подпись съезжали
                  // на 5-6pt от плиток в одной карточке.
                  <View style={{ paddingHorizontal: 5 }}>
                    <ChooseRow
                      compact
                      icon={CalendarRange}
                      label="Добавить календарь"
                      onPress={openCalendars}
                    />
                  </View>
                ) : null}
              </>
            )}
          </SectionCard>
          ) : null}

          {/* ПРАВА — РАЗДЕЛЫ ОДНИМ СЛОВОМ, БЕЗ СЧЁТЧИКОВ. Слово тише, когда
              раздел скрыт: нетронутый мастер читается «Скрыт ×4».
              Разделов столько, сколько ДЕРЖИТ СЕРВЕР: раздел, у которого все
              блоки спят, с карточки убран — он обещал бы настройку, которой
              нет (STORY-083). */}
          {shownAreas.length > 0 ? (
            <SectionCard title={p.calendarLine ? "Права в компании" : "Права"} padded={false}>
              {shownAreas.map((area, i) => {
                const level = p.areaLevels?.[area];
                return (
                  <NavRow
                    key={area}
                    label={AREA_TITLE[area]}
                    value={p.areaValues?.[area] || (level ? levelWord(level) : undefined)}
                    valueColor={level ? levelColor(t, level) : undefined}
                    separated={i > 0}
                    onPress={() => p.onOpenArea(area)}
                  />
                );
              })}
            </SectionCard>
          ) : null}
          {p.children}
        </ScrollView>

        {/* ГЛАВНОЕ ДЕЙСТВИЕ — ВНИЗУ, ВСЕГДА (AGENTS 7.1): 20 по бокам, 8 сверху,
            10 снизу. Внутри `KeyboardAvoidingView` — кнопка едет над
            клавиатурой, а не прячется под ней. */}
        {p.footer ? (
          <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 }}>
            {p.footer}
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </Screen>
  );
}

/** СТРОКА КАЛЕНДАРЯ С ЕГО ПРАВАМИ. Плитка цвета календаря, имя и одна строка
 *  прав этого календаря; тап — права этого календаря, свайп — открепить. */
function CalendarRightsRow({
  team,
  line,
  separated,
  onPress,
  onDetach,
}: {
  team: Team;
  line?: string;
  separated: boolean;
  onPress?: () => void;
  onDetach?: () => void;
}) {
  const t = useThemeColors();
  const row = (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={line ? `${team.name}: ${line}` : team.name}
      accessibilityHint={onPress ? "Открывает права в этом календаре" : undefined}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        minHeight: line ? 60 : 52,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderTopWidth: separated ? 1 : 0,
        borderTopColor: t.separator,
        backgroundColor: pressed && onPress ? t.pressed : t.surface,
      })}
    >
      <AppearanceTile color={team.color ?? null} icon={team.icon ?? null} fallback={CalendarRange} size={30} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ ...TYPE.callout, color: t.ink }}>
          {team.name}
        </Text>
        {line ? (
          <Text numberOfLines={2} maxFontSizeMultiplier={1.3} style={{ fontSize: 13, lineHeight: 17, color: t.sub, marginTop: 2 }}>
            {line}
          </Text>
        ) : null}
      </View>
      {onPress ? <ChevronRight color={t.chevron} size={18} strokeWidth={2.2} /> : null}
    </Pressable>
  );
  return onDetach ? (
    <SwipeRow label="Убрать" color={t.danger} onAction={onDetach} accessibilityLabel={`Убрать из ${team.name}`}>
      {row}
    </SwipeRow>
  ) : (
    row
  );
}
