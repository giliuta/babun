import { useRef } from "react";
import { ScrollView, Text, View } from "react-native";

import { EmptyState } from "@/components/ui/EmptyState";
import { GradientButton } from "@/components/ui/GradientButton";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ScopeChips } from "@/components/ui/ScopeChips";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { TYPE } from "@/components/ui/tokens";
import { haptics } from "@/lib/haptics";
import type { Team } from "@/features/reference/queries";
import { useThemeColors } from "@/theme/colors";

import type { AccessBlock, AccessLevel } from "../access-map";
import type { RightsArea } from "./master-draft";
import { sectionColumns, segmentSlot } from "./rights-columns";
import { levelSentence, segmentWord } from "./rights-copy";
import { rightsSections, type LevelReader } from "./rights-rows";
import type { RightsFocus } from "./rights-focus";

export type { RightsFocus };

// «ПРАВА» МАСТЕРА — ОДНА СТРАНИЦА НА ЧЕРНОВИК, ПРИГЛАШЕНИЕ И СОТРУДНИКА
// (владелец 15.09: «права — по-другому»). У каждого блока одна и та же строка:
// название, ФРАЗА ПРО ПОСЛЕДСТВИЕ и сегмент положений.
//
// СТРОКА ОТВЕЧАЕТ НА ВОПРОС ВЛАДЕЛЬЦА, А НЕ НАЗЫВАЕТ ТЕРМИН (владелец 20.09:
// «надо чётко показывать, что он может видеть, что может редактировать и что
// может делать»). Поэтому под названием стоит фраза выбранного положения —
// «Записи без денег: ни цены, ни долга», — а не слово «Скрыт».
//
// СЕГМЕНТ ВМЕСТО ШТОРКИ. Пресетов владелец не захотел («первой одной строкой
// не надо»), то есть список проходится целиком каждый раз: три положения
// видны сразу и ставятся одним касанием, вместо «тап → шторка → тап → закрыть».
// Кнопки «Сохранить» нет — выбранное ложится сразу.
//
// СТРОК ТОЛЬКО У ЖИВЫХ БЛОКОВ (STORY-083): пятнадцать из двадцати одного
// сервер не проверяет и не отказывает при записи, и настройка, которая
// сохраняется и ничего не делает, хуже отсутствующей.
//
// Календарей два и больше — сверху лента чипов: она переключает только
// строки блоков календаря, блоки компании стоят в конце своего раздела.
// Календаря нет вовсе — на странице только строки компании: календарную
// строку выставить некуда, а пригашенной она читалась бы сломанной.

/** В правах одного календаря разделы называются так же, как в его строке на
 *  карточке: «Записи» и «Деньги». */
const CALENDAR_SECTION_TITLE: Partial<Record<string, string>> = {
  calendar: "Записи",
  finance: "Деньги",
};

/** Короткие названия под шапкой раздела (аудит 24.09): длинные ломались на
 *  две строки рядом с сегментом, а шапка уже говорит, о чём раздел; фраза
 *  под строкой — что именно. */
const SHORT_FINANCE_TITLE: Record<string, string> = {
  "Доходы и расходы": "Операции",
  "Счета и остатки": "Счета",
  // Под шапкой «Клиенты» строка «Клиенты» повторяла её; «Телефоны и
  // контакты» ломались на две строки.
  Клиенты: "Карточки",
  "Телефоны и контакты": "Телефоны",
  // Копия у сотрудника не живёт (STORY-088: копия несёт клиента и суммы,
  // каждое поле спросило бы своё право) — строка говорит только про перенос.
  "Переносить и копировать записи": "Переносить",
};

/** Под шапкой «Записи» хвост «в записи» / «записи» лишний: «Статус записи» →
 *  «Статус», «Фото и файлы записи» → «Фото и файлы». */
export function shortRightsTitle(title: string): string {
  if (SHORT_FINANCE_TITLE[title]) return SHORT_FINANCE_TITLE[title];
  const short = title.replace(/\s+(в\s+)?записи$/u, "").trim();
  return short || title;
}

/** Пропсы вида из фокуса: заголовок, какие строки и какой календарь. */
export function focusViewProps(
  focus: RightsFocus | undefined,
  teams: readonly Team[],
): { title?: string; onlyCalendar: boolean; onlyCompany: boolean } {
  if (!focus) return { onlyCalendar: false, onlyCompany: false };
  if (focus.kind === "company") {
    return { title: "Права в компании", onlyCalendar: false, onlyCompany: true };
  }
  const name = teams.find((team) => team.id === focus.teamId)?.name;
  return { title: name ?? "Права", onlyCalendar: true, onlyCompany: false };
}

export function MasterRightsView({
  subtitle,
  onBack,
  blocks,
  teams,
  teamIds,
  activeTeamId,
  onSelectTeam,
  levelOf,
  busyKey = null,
  onPick,
  area,
  onPreview,
  title = "Права",
  onlyCalendar = false,
  onlyCompany = false,
}: {
  /** Заголовок: имя календаря, когда страница — права ОДНОГО календаря. */
  title?: string;
  /** Только строки этого календаря, без ленты чипов и без строк компании
   *  (STORY-087: у мастера в каждом календаре свои права — страница календаря
   *  открывается из его строки на карточке). */
  onlyCalendar?: boolean;
  /** Только строки компании (клиенты): календарные живут в своих календарях. */
  onlyCompany?: boolean;
  subtitle?: string;
  onBack: () => void;
  blocks: readonly AccessBlock[];
  teams: readonly Team[];
  /** Календари мастера, первый — домашний. */
  teamIds: readonly string[];
  activeTeamId: string | null;
  onSelectTeam: (teamId: string) => void;
  levelOf: LevelReader;
  /** Ключ блока, который сейчас сохраняется, — его строка ждёт ответа. Пока
   *  здесь стоял общий флаг, повторный тап по ЛЮБОЙ строке молча проглатывался
   *  и на экране не менялось ничего: на слабой связи это читается как
   *  сломанная кнопка. */
  busyKey?: string | null;
  onPick: (block: AccessBlock, level: AccessLevel, teamId: string | null) => void;
  /** Раздел, с которого открыли страницу, — к нему и прокручиваем. */
  area?: RightsArea;
  /** «Посмотреть его глазами»: включает зеркало и уводит в продукт. Нет —
   *  кнопки нет (например, пока не пришёл реестр блоков). */
  onPreview?: () => void;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const scrolled = useRef(false);

  const chips = teamIds
    .map((id) => teams.find((team) => team.id === id))
    .filter((team): team is Team => team !== undefined)
    .map((team) => ({ id: team.id, name: team.name, color: team.color }));
  const withChips = chips.length >= 2 && !onlyCalendar && !onlyCompany;
  // Выбранный календарь — только из тех, у кого есть чип: скрытый календарь
  // (архив) правился бы без подписи, а сервер молча снял бы правку.
  const activeId =
    activeTeamId !== null && chips.some((chip) => chip.id === activeTeamId)
      ? activeTeamId
      : (chips[0]?.id ?? null);
  const sections = rightsSections(blocks, levelOf, onlyCompany ? null : activeId)
    .map((section) => ({
      ...section,
      rows: section.rows.filter((row) =>
        onlyCalendar ? row.block.scope === "calendar" : onlyCompany ? row.block.scope !== "calendar" : true,
      ),
    }))
    .filter((section) => section.rows.length > 0);

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title={title} subtitle={subtitle} onBack={onBack} seam={!withChips} />
      {withChips ? (
        <ScopeChips items={chips} activeId={activeId} onSelect={onSelectTeam} />
      ) : null}
      {/* НИ ОДНОГО ЖИВОГО БЛОКА — ПУСТОЕ СОСТОЯНИЕ, А НЕ ПУСТОЕ ПОЛОТНО. Так
          бывает, когда живы только календарные блоки, а календаря у человека
          нет: без этого под шапкой оставалась белая страница и кнопка внизу. */}
      {sections.length === 0 ? (
        <EmptyState
          fill
          title="Прав пока нет"
          subtitle="Прикрепите человека к календарю — права ставятся в нём."
        />
      ) : (
      <ScrollView
        ref={scrollRef}
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 48 }}
      >
        {sections.map((section) => (
          <View
            key={section.area}
            onLayout={(event) => {
              if (section.area !== area || scrolled.current) return;
              scrolled.current = true;
              scrollRef.current?.scrollTo({ y: event.nativeEvent.layout.y, animated: false });
            }}
          >
            <SectionCard
              title={onlyCalendar ? (CALENDAR_SECTION_TITLE[section.area] ?? section.title) : section.title}
              padded={false}
            >
              {section.rows.map((row, i) => {
                const saving = busyKey === row.block.key;
                return (
                  <RightsRow
                    key={row.block.key}
                    columns={sectionColumns(section.rows.map((r) => ({ levels: r.block.levels })))}
                    separated={i > 0}
                    saving={saving}
                    title={onlyCalendar || onlyCompany ? shortRightsTitle(row.block.title) : row.block.title}
                    sentence={levelSentence(row.block.key, row.level)}
                    levels={row.block.levels}
                    level={row.level}
                    onPick={(level) => {
                      // Две записи не делят один снимок карты. Отказ — вслух:
                      // короткий тик в палец, иначе кнопка выглядит сломанной,
                      // а не занятой.
                      if (busyKey !== null) {
                        haptics.warning();
                        return;
                      }
                      onPick(row.block, level, row.block.scope === "calendar" ? activeId : null);
                    }}
                  />
                );
              })}
            </SectionCard>
          </View>
        ))}
      </ScrollView>
      )}
      {/* ЕДИНСТВЕННОЕ ДЕЙСТВИЕ СТРАНИЦЫ — ВНИЗУ (канон 7.1). Строки прав
          ставятся на месте и ничего не «сохраняют», поэтому футер занят тем,
          ради чего страницу и открывали: посмотреть, что из этого выйдет. */}
      {onPreview ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 }}>
          <GradientButton label="Посмотреть его глазами" onPress={onPreview} />
        </View>
      ) : null}
    </Screen>
  );
}

/** СТРОКА ПРАВА — ПЛОТНАЯ (STORY-087). Название и фраза положения слева,
 *  короткий сегмент справа: строка ~64pt вместо ~150, и все права календаря
 *  видны на одном экране. Фраза меняется вместе с сегментом — последствие
 *  читается до того, как отпущен палец. */
/** Ширина одного положения сегмента — одна колонка сетки прав. */
const SEGMENT_SLOT = 70;

export function RightsRow({
  title,
  sentence,
  levels,
  level,
  onPick,
  separated,
  saving,
  columns = 0,
}: {
  title: string;
  sentence: string;
  levels: readonly AccessLevel[];
  level: AccessLevel;
  onPick: (level: AccessLevel) => void;
  separated?: boolean;
  saving?: boolean;
  /** Колонок в сетке блока (`sectionColumns`); 0 — без сетки. */
  columns?: number;
}) {
  const t = useThemeColors();
  const slot = columns > 0 ? segmentSlot(levels) : null;
  const segment = (
    <SegmentedControl
      compact
      style={{ width: levels.length * SEGMENT_SLOT }}
      options={levels.map((value) => ({ value, label: segmentWord(levels, value) }))}
      value={level}
      onChange={onPick}
    />
  );
  return (
    <View
      style={{
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderTopWidth: separated ? 1 : 0,
        borderTopColor: t.separator,
        // Строка, которая сейчас уезжает на сервер, пригашена: видно, ЧТО
        // именно ждёт ответа.
        opacity: saving ? 0.5 : 1,
      }}
    >
      {/* Название и сегмент — в одну линию; фраза положения — под ними во всю
          ширину: так строка не ломается на три-четыре строки текста. */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Text
          numberOfLines={2}
          maxFontSizeMultiplier={1.3}
          style={{ ...TYPE.callout, color: t.ink, flex: 1, minWidth: 0 }}
        >
          {title}
        </Text>
        {slot ? (
          // Сетка блока: сегмент стоит с колонки своего первого положения,
          // пустая колонка справа — положение, которого у права нет.
          <View style={{ width: columns * SEGMENT_SLOT, paddingLeft: slot.start * SEGMENT_SLOT }}>
            {segment}
          </View>
        ) : (
          segment
        )}
      </View>
      <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 13, lineHeight: 17, color: t.sub, marginTop: 4 }}>
        {sentence}
      </Text>
    </View>
  );
}
