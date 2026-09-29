import { AREA_TITLE, type AccessBlock, type AccessLevel } from "../access-map";
import { isClosedStep, rightTitle } from "../rights-ui/right-words";
import { teamSentence } from "../rights-ui/team-sentence";
import {
  CALENDAR_GROUPS,
  CALENDAR_GROUP_TITLE,
  SECTION_BLOCKS,
  inGroup,
  orderGroupRows,
  type CalendarGroup,
} from "./access-summary";
import { CREATE_KEY, RECORDS_KEY, recordsRowLevel, type RightsArea } from "./master-draft";
import { offeredBlocks } from "./rights-copy";
import { rightsSections, type LevelReader, type RightsRow } from "./rights-rows";

// КАКИЕ КАРТОЧКИ ПРАВ СТОЯТ НА СТРАНИЦЕ — БЕЗ REACT. Одно правило на три
// места: главная страница сотрудника (права выбранной команды под лентой
// команд), страница шаблона и страница прав черновика или приглашения.

export interface ViewSection {
  key: string;
  area: RightsArea;
  title: string;
  rows: RightsRow[];
}

export function viewSections({
  blocks,
  levelOf,
  activeId,
  onlyCalendar,
  onlyCompany,
  area,
  withCompany = false,
  group,
}: {
  blocks: readonly AccessBlock[];
  levelOf: LevelReader;
  activeId: string | null;
  /** Права ОДНОЙ команды — разделами приложения, без строк компании. */
  onlyCalendar: boolean;
  /** Только строки компании (её раздел `area`, если назван). */
  onlyCompany: boolean;
  area?: RightsArea;
  /** К правам команды — карточка «Компания» с правами на всю компанию:
   *  на главной странице сотрудника они живут под той же лентой. */
  withCompany?: boolean;
  /** Страница ОДНОГО раздела доступа («Календарь»): только его карточка. */
  group?: CalendarGroup;
}): ViewSection[] {
  const registry = rightsSections(blocks, levelOf, onlyCompany ? null : activeId)
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
  if (!onlyCalendar) return registry.filter((section) => section.rows.length > 0);
  // ПРАВА ОДНОЙ КОМАНДЫ — БЛОКАМИ РАЗДЕЛОВ ПРИЛОЖЕНИЯ (владелец 29.09):
  // «Календарь», «Запись» (в порядке блоков страницы записи), «Финансы»,
  // «Клиенты». В реестре первые два — один раздел «Записи».
  const calendarRows = registry.flatMap((section) => section.rows);
  const team: ViewSection[] = CALENDAR_GROUPS.filter((each) => !group || each === group).map((each) => ({
    key: each as string,
    area: (each === "finance" ? "finance" : each === "clients" ? "clients" : "calendar") as RightsArea,
    title: CALENDAR_GROUP_TITLE[each],
    rows: orderGroupRows(
      each,
      calendarRows.filter((row) => inGroup(row.block.key, each)),
    ),
  }));
  const company: ViewSection[] = withCompany && !group
    ? [
        {
          key: "company",
          area: "company",
          title: AREA_TITLE.company,
          rows: rightsSections(blocks, levelOf, null)
            .flatMap((section) => section.rows)
            .filter((row) => row.block.scope !== "calendar"),
        },
      ]
    : [];
  if (group) return groupPage(group, team[0]);
  return [...team, ...company].filter((section) => section.rows.length > 0);
}

/** Страница одного раздела — его блоками (`SECTION_BLOCKS`). Шапка пустая —
 *  карточка без шапки. */
function groupPage(group: CalendarGroup, section: ViewSection | undefined): ViewSection[] {
  if (!section) return [];
  const blocks = SECTION_BLOCKS[group] ?? [];
  const parts: ViewSection[] = blocks.map((block) => ({
    key: `${group}.${block.key}`,
    area: section.area,
    title: block.title,
    rows: section.rows.filter((row) => block.keys.includes(row.block.key)),
  }));
  const placed = new Set(parts.flatMap((part) => part.rows.map((row) => row.block.key)));
  const rest = section.rows.filter((row) => !placed.has(row.block.key));
  return [...parts, { key: `${group}.rest`, area: section.area, title: "", rows: rest }].filter(
    (part) => part.rows.length > 0,
  );
}

/** Положения всех живых прав команды — по ним рисуются вид блока в шторке и
 *  итог (свёрнутые зависимые читаются как есть). */
export function teamLevels(
  blocks: readonly AccessBlock[],
  levelOf: LevelReader,
  activeId: string | null,
): Record<string, AccessLevel> {
  const levels: Record<string, AccessLevel> = {};
  for (const block of offeredBlocks(blocks)) {
    levels[block.key] = levelOf(block, block.scope === "calendar" ? activeId : null);
  }
  // Ступень «Записей клиентов» — та же, что на их строке (`recordsRowLevel`).
  const records = levels[RECORDS_KEY];
  if (records !== undefined) levels[RECORDS_KEY] = recordsRowLevel(records, levels[CREATE_KEY] ?? "off");
  return levels;
}

/** Итог команды одной-тремя фразами — по живым правам. */
export function teamSummary(blocks: readonly AccessBlock[], levels: Readonly<Record<string, AccessLevel>>): string {
  const live = new Set(offeredBlocks(blocks).map((block) => block.key));
  return teamSentence((key) => (live.has(key) ? levels[key] : undefined));
}

/** Подпись строки раздела в блоке «Доступ» — что в нём открыто, словами
 *  строк самого раздела: «События, метка дня, график команды». Ничего —
 *  «Всё закрыто»; всё — «Всё открыто». */
export function sectionBrief(section: Pick<ViewSection, "rows">): string {
  const open = section.rows.filter((row) => !isClosedStep(row.level));
  if (open.length === 0) return "Всё закрыто";
  if (open.length === section.rows.length) return "Всё открыто";
  return open
    .map((row, i) => {
      const title = rightTitle(row.block);
      return i === 0 ? title : title.charAt(0).toLowerCase() + title.slice(1);
    })
    .join(", ");
}
