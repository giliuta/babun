import { useRef, type ReactNode } from "react";
import { ScrollView, View } from "react-native";

import { EmptyState } from "@/components/ui/EmptyState";
import { GradientButton } from "@/components/ui/GradientButton";
import { ScopeChips } from "@/components/ui/ScopeChips";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import type { Team } from "@/features/reference/queries";
import { useThemeColors } from "@/theme/colors";

import { AREA_TITLE, type AccessBlock, type AccessLevel } from "../access-map";
import { TeamRightsCards } from "../rights-ui/TeamRightsCards";
import { CALENDAR_GROUP_TITLE, type CalendarGroup } from "./access-summary";
import type { RightsArea } from "./master-draft";
import type { LevelReader } from "./rights-rows";
import type { RightsFocus } from "./rights-focus";
import { teamLevels, viewSections } from "./rights-view-sections";

export type { RightsFocus };

// «ПРАВА» — ОДНА СТРАНИЦА НА ЧЕРНОВИК, ПРИГЛАШЕНИЕ, СОТРУДНИКА И ШАБЛОН.
//
// СТРОКИ И ШТОРКА (владелец 29.09: «как в настройках iPhone… по строке
// поднимается шторка, и сам этот блок визуально в этой шторке сверху»).
// Строки, итог и шторку рисует `TeamRightsCards` — то же тело стоит на
// главной странице сотрудника под лентой команд. Кнопки «Сохранить» нет —
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
): { title?: string; onlyCalendar: boolean; onlyCompany: boolean; group?: CalendarGroup } {
  if (!focus) return { onlyCalendar: false, onlyCompany: false };
  if (focus.kind === "company") {
    return { title: AREA_TITLE.company, onlyCalendar: false, onlyCompany: true };
  }
  // Раздел доступа — его имя в шапке («Календарь»), команда — в подписи.
  if (focus.group) {
    return { title: CALENDAR_GROUP_TITLE[focus.group], onlyCalendar: true, onlyCompany: false, group: focus.group };
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
  group,
  top,
  lockedAll,
}: {
  /** Страница одного раздела доступа («Календарь»): только его права. */
  group?: CalendarGroup;
  /** Над разделами. */
  top?: ReactNode;
  /** Права отсюда не меняются — почему (директор: себя и директоров ведёт
   *  владелец, 04.10). */
  lockedAll?: string;
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

  const sections = viewSections({
    blocks,
    levelOf,
    activeId,
    onlyCalendar,
    onlyCompany,
    area: onlyCompany ? area : undefined,
    group,
  });
  const companyTitle = onlyCompany && area ? AREA_TITLE[area] : null;
  const levels = teamLevels(blocks, levelOf, activeId);

  return (
    <Screen edges={["top"]}>
      <ScreenHeader
        title={companyTitle ?? title}
        subtitle={group ? [subtitle, teamName].filter(Boolean).join(" · ") || undefined : subtitle}
        onBack={onBack}
        seam={!withChips}
      />
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
          <TeamRightsCards
            blocks={blocks}
            sections={sections}
            levels={levels}
            sheetSubtitle={(block) =>
              [subtitle, block.scope === "calendar" ? teamName : "Весь аккаунт"].filter(Boolean).join(" · ") ||
              undefined
            }
            teamName={teamName}
            teamColor={teamColor}
            busyKey={busyKey}
            teamId={activeId}
            lockedAll={lockedAll}
            onPick={(block, level) => onPick(block, level, block.scope === "calendar" ? activeId : null)}
            onSectionLayout={(section, y) => {
              if (section.area !== area || scrolled.current) return;
              scrolled.current = true;
              scrollRef.current?.scrollTo({ y, animated: false });
            }}
          />
        </ScrollView>
      )}
      {/* ЕДИНСТВЕННОЕ ДЕЙСТВИЕ СТРАНИЦЫ — ВНИЗУ (канон 7.1): посмотреть, что
          из этого выйдет. */}
      {onPreview ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 }}>
          <GradientButton label="Посмотреть его глазами" onPress={onPreview} />
        </View>
      ) : null}
    </Screen>
  );
}
