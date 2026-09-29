import { useRef, useState, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";

import { NavRow } from "@/components/ui/card-rows";
import { EmptyState } from "@/components/ui/EmptyState";
import { GradientButton } from "@/components/ui/GradientButton";
import { ScopeChips } from "@/components/ui/ScopeChips";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { haptics } from "@/lib/haptics";
import type { Team } from "@/features/reference/queries";
import { useThemeColors } from "@/theme/colors";

import { AREA_TITLE, type AccessBlock, type AccessLevel } from "../access-map";
import { RightSheet } from "../rights-ui/RightSheet";
import { isClosedStep, rightTitle, stepDanger, stepWord } from "../rights-ui/right-words";
import { teamSentence } from "../rights-ui/team-sentence";
import { CALENDAR_GROUPS, CALENDAR_GROUP_TITLE, inGroup, orderGroupRows } from "./access-summary";
import type { RightsArea } from "./master-draft";
import { offeredBlocks } from "./rights-copy";
import { rightsSections, type LevelReader } from "./rights-rows";
import type { RightsFocus } from "./rights-focus";

export type { RightsFocus };

// «ПРАВА» — ОДНА СТРАНИЦА НА ЧЕРНОВИК, ПРИГЛАШЕНИЕ, СОТРУДНИКА И ШАБЛОН.
//
// СТРОКИ И ШТОРКА (владелец 29.09: «как в настройках iPhone… по строке
// поднимается шторка, и сам этот блок визуально в этой шторке сверху»). Строка
// — право и его ступень словом этого права («Клиент — Видит», «Счета —
// Управляет»); тап поднимает шторку, где сверху стоит сам блок так, как его
// увидит сотрудник, а ниже — ступени с пояснением. Сегменты по три положения
// в каждой строке (так было до 29.09) делали страницу в два экрана высотой.
//
// Над разделами у страницы команды — ИТОГ одной-тремя фразами: что он видит,
// что с клиентами и деньгами, может ли удалять. Кнопки «Сохранить» нет —
// выбранное ложится сразу.
//
// СТРОК ТОЛЬКО У ЖИВЫХ БЛОКОВ (STORY-083): пятнадцать из двадцати одного
// сервер не проверяет и не отказывает при записи, и настройка, которая
// сохраняется и ничего не делает, хуже отсутствующей.
//
// Календарей два и больше — сверху лента чипов: она переключает только
// строки блоков календаря, блоки компании стоят в конце своего раздела.
// Календаря нет вовсе — на странице только строки компании: календарную
// строку выставить некуда, а пригашенной она читалась бы сломанной.

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
  top,
  summaryFooter,
}: {
  /** Над разделами: карточка имени шаблона. */
  top?: ReactNode;
  /** Строка внутри «Итога» под фразой — «Шаблон» у прав команды. */
  summaryFooter?: ReactNode;
  /** Заголовок: имя календаря, когда страница — права ОДНОГО календаря. */
  title?: string;
  /** Только строки этого календаря, без ленты чипов и без строк компании
   *  (STORY-087: у мастера в каждом календаре свои права). */
  onlyCalendar?: boolean;
  /** Только строки компании: календарные живут в своих командах. */
  onlyCompany?: boolean;
  subtitle?: string;
  onBack: () => void;
  blocks: readonly AccessBlock[];
  teams: readonly Team[];
  /** Календари человека, первый — домашний. */
  teamIds: readonly string[];
  activeTeamId: string | null;
  onSelectTeam: (teamId: string) => void;
  levelOf: LevelReader;
  /** Ключ блока, который сейчас сохраняется, — его строка ждёт ответа. */
  busyKey?: string | null;
  onPick: (block: AccessBlock, level: AccessLevel, teamId: string | null) => void;
  /** Раздел, с которого открыли страницу, — к нему и прокручиваем. */
  area?: RightsArea;
  /** «Посмотреть его глазами»: включает зеркало и уводит в продукт. */
  onPreview?: () => void;
}) {
  const t = useThemeColors();
  const scrollRef = useRef<ScrollView>(null);
  const scrolled = useRef(false);
  /** Право, чья шторка открыта; держится, пока шторка уезжает. */
  const [sheetKey, setSheetKey] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const chips = teamIds
    .map((id) => teams.find((team) => team.id === id))
    .filter((team): team is Team => team !== undefined)
    .map((team) => ({ id: team.id, name: team.name, color: team.color }));
  const withChips = chips.length >= 2 && !onlyCalendar && !onlyCompany;
  // Выбранный календарь — только из тех, у кого есть чип: скрытый календарь
  // (архив) правился бы без подписи, а сервер молча снял бы правку.
  // Страница ОДНОЙ команды (или шаблона) берёт свой календарь как есть: в
  // шаблоне календаря в ленте нет вовсе.
  const activeId =
    activeTeamId !== null && (onlyCalendar || chips.some((chip) => chip.id === activeTeamId))
      ? activeTeamId
      : (chips[0]?.id ?? null);
  const team = teams.find((candidate) => candidate.id === activeId) ?? null;
  const teamName = team?.name ?? title;
  const teamColor = team?.color ?? t.accent;

  const registrySections = rightsSections(blocks, levelOf, onlyCompany ? null : activeId)
    .map((section) => ({
      key: section.area as string,
      area: section.area,
      title: section.title,
      rows: section.rows.filter((row) =>
        onlyCalendar ? row.block.scope === "calendar" : onlyCompany ? row.block.scope !== "calendar" : true,
      ),
    }))
    // Права компании, открытые строкой «Компания», — только свой раздел.
    .filter((section) => !(onlyCompany && area) || section.area === area);
  // ПРАВА ОДНОЙ КОМАНДЫ — БЛОКАМИ РАЗДЕЛОВ ПРИЛОЖЕНИЯ (владелец 29.09):
  // «Календарь», «Запись» (в порядке блоков страницы записи), «Финансы»,
  // «Клиенты». В реестре первые два — один раздел «Записи».
  const sections = (
    onlyCalendar
      ? CALENDAR_GROUPS.map((group) => ({
          key: group as string,
          area: (group === "finance" ? "finance" : group === "clients" ? "clients" : "calendar") as RightsArea,
          title: CALENDAR_GROUP_TITLE[group],
          rows: orderGroupRows(
            group,
            registrySections
              .flatMap((section) => section.rows)
              .filter((row) => inGroup(row.block.key, group)),
          ),
        }))
      : registrySections
  ).filter((section) => section.rows.length > 0);
  const companyTitle = onlyCompany && area ? AREA_TITLE[area] : null;

  // ПОЛОЖЕНИЯ ВСЕХ ЖИВЫХ ПРАВ ЭТОЙ КОМАНДЫ — вид блока в шторке и итог
  // считаются по ним (свёрнутые зависимые читаются как есть).
  const live = offeredBlocks(blocks);
  const levels: Record<string, AccessLevel> = {};
  for (const block of live) {
    levels[block.key] = levelOf(block, block.scope === "calendar" ? activeId : null);
  }
  const liveKeys = new Set(live.map((block) => block.key));
  const summary = onlyCalendar ? teamSentence((key) => (liveKeys.has(key) ? levels[key] : undefined)) : null;
  const sheetBlock = live.find((block) => block.key === sheetKey) ?? null;

  const open = (block: AccessBlock) => {
    // Две записи не делят один снимок карты. Отказ — вслух: короткий тик в
    // палец, иначе строка выглядит сломанной, а не занятой.
    if (busyKey !== null) {
      haptics.warning();
      return;
    }
    haptics.tap();
    setSheetKey(block.key);
    setSheetOpen(true);
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title={companyTitle ?? title} subtitle={subtitle} onBack={onBack} seam={!withChips} />
      {withChips ? (
        <ScopeChips items={chips} activeId={activeId} onSelect={onSelectTeam} />
      ) : null}
      {/* НИ ОДНОГО ЖИВОГО БЛОКА — ПУСТОЕ СОСТОЯНИЕ, А НЕ ПУСТОЕ ПОЛОТНО. */}
      {sections.length === 0 ? (
        <EmptyState
          fill
          title="Прав пока нет"
          subtitle="Добавьте человека в команду — права ставятся в ней."
        />
      ) : (
        <ScrollView ref={scrollRef} className="flex-1" contentContainerStyle={{ paddingBottom: 48 }}>
          {top ?? null}
          {summary ? (
            <SectionCard title="Итог" padded={false}>
              <Text
                maxFontSizeMultiplier={1.3}
                style={{ paddingHorizontal: 16, paddingTop: 2, paddingBottom: 12, fontSize: 15, lineHeight: 21, color: t.ink }}
              >
                {summary}
              </Text>
              {summaryFooter ?? null}
            </SectionCard>
          ) : null}
          {sections.map((section) => (
            <View
              key={section.key}
              onLayout={(event) => {
                if (section.area !== area || scrolled.current) return;
                scrolled.current = true;
                scrollRef.current?.scrollTo({ y: event.nativeEvent.layout.y, animated: false });
              }}
            >
              <SectionCard title={section.title} padded={false}>
                {section.rows.map((row, i) => {
                  const danger = stepDanger(row.block, row.level) !== null;
                  return (
                    <NavRow
                      key={row.block.key}
                      separated={i > 0}
                      label={rightTitle(row.block)}
                      value={stepWord(row.block, row.level)}
                      valueColor={isClosedStep(row.level) ? t.faint : danger ? t.warning : undefined}
                      dimmed={busyKey === row.block.key}
                      onPress={() => open(row.block)}
                    />
                  );
                })}
              </SectionCard>
            </View>
          ))}
        </ScrollView>
      )}
      {/* ЕДИНСТВЕННОЕ ДЕЙСТВИЕ СТРАНИЦЫ — ВНИЗУ (канон 7.1): посмотреть, что
          из этого выйдет. */}
      {onPreview ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 }}>
          <GradientButton label="Посмотреть его глазами" onPress={onPreview} />
        </View>
      ) : null}
      <RightSheet
        visible={sheetOpen}
        block={sheetBlock}
        blocks={blocks}
        levels={levels}
        subtitle={[subtitle, onlyCompany ? null : teamName].filter(Boolean).join(" · ") || undefined}
        teamName={teamName}
        teamColor={teamColor}
        busy={busyKey !== null}
        onPick={(block, level) => onPick(block, level, block.scope === "calendar" ? activeId : null)}
        onClose={() => setSheetOpen(false)}
      />
    </Screen>
  );
}
