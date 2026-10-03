import { AREA_TITLE, type AccessBlock, type AccessLevel } from "../access-map";
import { briefTitle, isClosedStep } from "../rights-ui/right-words";
import {
  CALENDAR_GROUPS,
  CALENDAR_GROUP_TITLE,
  SECTION_BLOCKS,
  inGroup,
  orderCabinetRows,
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
  // ПРАВА НА ВСЮ КОМПАНИЮ, КОТОРЫЕ СТОЯТ В БЛОКЕ РАЗДЕЛА («Валюта» — строка
  // шестерёнки «Финансов», владелец 03.10: «права = строки шестерёнки»). На
  // странице команды они стоят в своём блоке — там, где их видит человек, — а
  // из раздела «Кабинет» уходят, чтобы одно право не стояло дважды.
  // «Реквизиты» с 04.10 — в «Кабинете», где их строка и живёт. Положение у них одно на всю компанию: строка читает и
  // пишет его без команды (`blockChanges` → `team_id: null`).
  const claimed = claimedKeys();
  const registry = rightsSections(blocks, levelOf, onlyCompany ? null : activeId)
    .map((section) => ({
      key: section.area as string,
      area: section.area,
      title: section.title,
      rows: section.rows.filter((row) =>
        onlyCalendar
          ? row.block.scope === "calendar" || claimed.has(row.block.key)
          : onlyCompany
            ? row.block.scope !== "calendar" && !claimed.has(row.block.key)
            : true,
      ),
    }));
  // РАЗДЕЛ «КАБИНЕТ» (04.10) — одной карточкой: права аккаунта из разных
  // разделов реестра («Реквизиты» числятся за финансами) стоят вместе, в
  // порядке строк Кабинета.
  if (onlyCompany) {
    const rows = orderCabinetRows(registry.flatMap((section) => section.rows));
    // Карточка одна — без шапки: имя раздела уже в шапке страницы.
    return rows.length > 0 && (!area || area === "company")
      ? [{ key: "company", area: "company", title: "", rows }]
      : [];
  }
  if (!onlyCalendar) return registry.filter((section) => section.rows.length > 0);
  // ПРАВА ОДНОЙ КОМАНДЫ — БЛОКАМИ РАЗДЕЛОВ ПРИЛОЖЕНИЯ (владелец 29.09):
  // «Календарь», «Запись» (в порядке блоков страницы записи), «Финансы»,
  // «Клиенты». В реестре первые два — один раздел «Записи».
  const calendarRows = registry.flatMap((section) => section.rows);
  const team: ViewSection[] = CALENDAR_GROUPS.map((each) => ({
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
          rows: orderCabinetRows(
            rightsSections(blocks, levelOf, null)
              .flatMap((section) => section.rows)
              .filter((row) => row.block.scope !== "calendar" && !claimed.has(row.block.key)),
          ),
        },
      ]
    : [];
  if (group) return groupPage(group, team);
  // Раздел несёт те строки, что стоят на его странице: право, переехавшее
  // блоком в чужой раздел («Доходы и расходы» — в «Главное» «Календаря»),
  // и в блоке «Доступ», и на странице шаблона стоит там же.
  const paged = team.map((section) => ({
    ...section,
    rows: groupPage(section.key as CalendarGroup, team).flatMap((part) => part.rows),
  }));
  return [...paged, ...company].filter((section) => section.rows.length > 0);
}

/** Ключи, которые блоки разделов (`SECTION_BLOCKS`) забирают себе. */
function claimedKeys(): Set<string> {
  return new Set(
    Object.values(SECTION_BLOCKS).flatMap((blocks) => (blocks ?? []).flatMap((block) => block.keys)),
  );
}

/** Страница одного раздела — его блоками (`SECTION_BLOCKS`). Блок берёт свои
 *  права из любого раздела и в своём порядке; остальные права раздела —
 *  последней карточкой без шапки, кроме тех, что увёл блок другого раздела. */
function groupPage(group: CalendarGroup, sections: readonly ViewSection[]): ViewSection[] {
  const own = sections.find((section) => section.key === group);
  if (!own) return [];
  const pool = sections.flatMap((section) => section.rows);
  const blocks = SECTION_BLOCKS[group] ?? [];
  const parts: ViewSection[] = blocks.map((block) => ({
    key: `${group}.${block.key}`,
    area: own.area,
    title: block.title,
    rows: block.keys.flatMap((key) => pool.filter((row) => row.block.key === key)),
  }));
  const placed = new Set(parts.flatMap((part) => part.rows.map((row) => row.block.key)));
  const claimed = new Set(
    Object.entries(SECTION_BLOCKS)
      .filter(([other]) => other !== group)
      .flatMap(([, others]) => (others ?? []).flatMap((block) => block.keys)),
  );
  const rest = own.rows.filter((row) => !placed.has(row.block.key) && !claimed.has(row.block.key));
  return [...parts, { key: `${group}.rest`, area: own.area, title: "", rows: rest }].filter(
    (part) => part.rows.length > 0,
  );
}

/** Положения всех живых прав команды — по ним рисуется вид блока в шторке
 *  (свёрнутые зависимые читаются как есть). */
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

/** Подпись строки раздела в блоке «Доступ» — что в нём открыто, словами
 *  строк самого раздела: «События, метка дня, график команды». Ничего —
 *  «Всё закрыто»; всё — «Всё открыто». */
export function sectionBrief(section: Pick<ViewSection, "rows">): string {
  // Серая строка (главный блок скрыт) не открыта, что бы в ней ни стояло.
  const open = section.rows.filter((row) => !row.foldedBy && !isClosedStep(row.level));
  if (open.length === 0) return "Всё закрыто";
  if (open.length === section.rows.length) return "Всё открыто";
  return open
    .map((row, i) => {
      const title = briefTitle(row.block);
      return i === 0 ? title : title.charAt(0).toLowerCase() + title.slice(1);
    })
    .join(", ");
}
