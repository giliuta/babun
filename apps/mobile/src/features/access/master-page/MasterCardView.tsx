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
import { MoreHorizontal } from "lucide-react-native";

import { NavRow } from "@/components/ui/card-rows";
import { ScopeChips } from "@/components/ui/ScopeChips";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { ICON } from "@/components/ui/tokens";
import type { Team } from "@/features/reference/queries";
import { useThemeColors } from "@/theme/colors";

import { AREA_TITLE } from "../access-map";
import {
  levelTone,
  type AreaLevel,
  type RightsArea,
} from "./master-draft";
import { RIGHTS_AREAS, levelWord } from "./rights-rows";
import { EmployeeTeamsBlock } from "./EmployeeTeamsBlock";
import {
  EmployeeIdentityBlock,
  type EmployeeAccessLine,
  type EmployeeContacts,
} from "./EmployeeIdentityBlock";

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
  /** ПАРТНЁР ПРИГЛАШАЕТСЯ ПО ПОЧТЕ — И ТОЛЬКО (владелец 01.10: «да, давай
   *  так и сделаем — по почте»). Имя и телефон — его, из профиля в Babun:
   *  сервер берёт их при приёме (`attach_invited_master_card`). В блоке
   *  «Партнёр» — одна строка почты. */
  emailOnly?: boolean;
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
  /** Слово строки раздела вместо «Частично» — например, «Меняет · свои». */
  areaValues?: Partial<Record<RightsArea, string>>;
  onOpenCalendarRights?: (teamId: string) => void;
  /** Свайп по календарю — открепить. Нет — свайпа нет. */
  onDetachCalendar?: (teamId: string) => void;
  /** Кнопка в хвосте номера — «Связаться». */
  phoneAction?: ReactNode;
  /** «В приложении · сегодня, 13:40» под почтой — живой ли аккаунт. Нет —
   *  строки нет. */
  accountSeen?: string;
  /** Строка «Доступ в CRM» в блоке «Сотрудник». Нет — строки нет. */
  access?: EmployeeAccessLine;
  /** Контакты под основным номером и «Добавить контакт». Нет — у человека
   *  без карточки мастера их писать некуда. */
  contacts?: EmployeeContacts;
  /** «Заметка сотрудника» — сразу под блоком «Сотрудник». */
  note?: ReactNode;
  /** Итог прав человека в команде выжимкой через точку (строка команды).
   *  Есть — строка команды открывает её права. */
  teamLine?: (teamId: string) => string;
  /** «Посмотреть его глазами» — строкой в блоке «Доступ». */
  onMirror?: () => void;
  /** Блоки ниже прав: «Работа», «Личное». */
  children?: ReactNode;
  /** ЛЕНТА КОМАНД ПОД ШАПКОЙ, КАК В НАСТРОЙКАХ КАЛЕНДАРЯ (владелец 29.09:
   *  «захожу в календарь команда один, и там полностью все настройки по
   *  каждому — вот так»). Есть — права выбранной команды стоят прямо на
   *  странице (`teamRights`), вместо строк команд и карточки «Компания». */
  teamChips?: {
    activeId: string | null;
    onSelect: (teamId: string) => void;
    /** «Добавить» справа от ленты — в какие команды он входит. */
    onAdd?: () => void;
  };
  /** Права выбранной команды — итог, шаблон, строки по разделам. */
  teamRights?: ReactNode;
}

/** «Добавить» справа от ленты команд — тем же словом и видом, что в
 *  настройках календаря: текстом, без «+» (стандарт «Добавить»). */
function ChipsAddButton({ onPress }: { onPress: () => void }) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Добавить в команду"
      style={({ pressed }) => ({ minHeight: 44, justifyContent: "center", opacity: pressed ? 0.5 : 1 })}
    >
      <Text maxFontSizeMultiplier={1.2} style={{ fontSize: 15, fontWeight: "600", color: t.accent }}>
        Добавить
      </Text>
    </Pressable>
  );
}

export function MasterCardView(p: MasterCardViewProps) {
  const t = useThemeColors();
  // Календарные разделы живут в строках команд — в «Компании» остаются
  // разделы, у которых есть права на всю компанию (клиенты, шаблоны SMS).
  const companyAreas = (p.liveAreas ?? RIGHTS_AREAS).filter(
    (area) => area !== "calendar" && area !== "finance",
  );
  const chosen = p.teamIds
    .map((id) => p.teams.find((team) => team.id === id))
    .filter((team): team is Team => team !== undefined);
  const anyUnchosen = p.teams.some((team) => !p.teamIds.includes(team.id));
  const openCalendars = p.onOpenCalendars;

  return (
    <Screen edges={["top"]}>
      {/* Шов под шапкой один — при ленте его несёт она. */}
      <ScreenHeader
        title={p.title}
        subtitle={p.subtitle}
        onBack={p.onBack}
        right={p.headerRight}
        seam={!p.teamChips}
      />
      {p.teamChips ? (
        <ScopeChips
          // В ПОРЯДКЕ КОМАНД КОМПАНИИ, как лента настроек календаря: одна и та
          // же команда стоит на одном месте в обеих лентах.
          items={p.teams
            .filter((team) => p.teamIds.includes(team.id))
            .map((team) => ({ id: team.id, name: team.name, color: team.color }))}
          activeId={p.teamChips.activeId}
          onSelect={p.teamChips.onSelect}
          trailing={p.teamChips.onAdd ? <ChipsAddButton onPress={p.teamChips.onAdd} /> : undefined}
        />
      ) : null}
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
          <EmployeeIdentityBlock {...p} />
          {p.note ?? null}

          {/* КОМАНДЫ — ПРАВА ПО КАЖДОЙ КОМАНДЕ (владелец 29.09): строка на
              команду со сводкой её прав, тап — права этой команды. Карточка
              без аккаунта показывает команды без сводки: прав у неё нет. */}
          {p.teamRights ?? null}
          {p.showCalendars && !p.teamChips ? (
            <EmployeeTeamsBlock
              teams={chosen}
              line={p.teamLine}
              onOpenTeam={p.teamLine ? p.onOpenCalendarRights : undefined}
              onRemoveTeam={p.onDetachCalendar}
              onAddTeam={openCalendars && anyUnchosen ? openCalendars : undefined}
              onMirror={p.onMirror}
            />
          ) : null}

          {/* АККАУНТ — ПРАВА НЕ ПРО КОМАНДУ: раздел «Кабинет» (тариф, оплаты,
              SMS, реквизиты — 04.10). */}
          {companyAreas.length > 0 && !p.teamChips ? (
            <SectionCard title="Аккаунт" padded={false}>
              {companyAreas.map((area, i) => {
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
