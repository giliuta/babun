import type { AccessBlock, AccessChange, AccessLevel } from "../access-map";
import { offeredBlocks } from "../master-page/rights-copy";

// ШАБЛОНЫ ДОСТУПА — ЧИСТОЕ ПРАВИЛО (владелец 29.09: «давать ему разрешение
// очень правильно, точечно… с шаблонами»). Шаблон — набор положений прав
// КОМАНДЫ (блоки календаря: «Календарь», «Запись», «Финансы», «Клиенты»).
// Применяется КОПИЕЙ: положения ложатся обычной записью прав в одну команду,
// дальше строки правятся руками, а правка шаблона людей не трогает.

export interface AccessTemplate {
  id: string;
  name: string;
  levels: Readonly<Record<string, AccessLevel>>;
  position: number;
}

const LEVELS: readonly AccessLevel[] = ["off", "read", "write", "own", "all"];

function isLevel(value: unknown): value is AccessLevel {
  return typeof value === "string" && (LEVELS as readonly string[]).includes(value);
}

/** Строки таблицы → шаблоны; мусор в положениях отбрасывается. */
export function parseTemplates(rows: readonly unknown[]): AccessTemplate[] {
  const out: AccessTemplate[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.name !== "string") continue;
    const levels: Record<string, AccessLevel> = {};
    if (typeof r.levels === "object" && r.levels !== null && !Array.isArray(r.levels)) {
      for (const [key, value] of Object.entries(r.levels as Record<string, unknown>)) {
        if (isLevel(value)) levels[key] = value;
      }
    }
    out.push({ id: r.id, name: r.name, levels, position: typeof r.position === "number" ? r.position : 0 });
  }
  return out.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "ru"));
}

/** Блоки, которые несёт шаблон: живые блоки команды. */
export function templateBlocks(blocks: readonly AccessBlock[]): AccessBlock[] {
  return offeredBlocks(blocks).filter((block) => block.scope === "calendar");
}

/** Положение блока в шаблоне; нет или чужое положение — умолчание блока. */
export function templateLevel(template: Pick<AccessTemplate, "levels">, block: AccessBlock): AccessLevel {
  const level = template.levels[block.key];
  return level !== undefined && block.levels.includes(level) ? level : (block.levels[0] ?? "off");
}

/** Что записать, чтобы права человека в команде стали как в шаблоне. */
export function templateChanges(
  blocks: readonly AccessBlock[],
  template: Pick<AccessTemplate, "levels">,
  teamId: string,
): AccessChange[] {
  return templateBlocks(blocks).map((block) => ({
    block: block.key,
    team_id: teamId,
    level: templateLevel(template, block),
  }));
}

/** Шаблон, по которому сейчас стоят права в команде (все живые блоки
 *  команды совпадают); иначе `null` — права «свои». */
export function matchedTemplate(
  blocks: readonly AccessBlock[],
  levelOf: (block: AccessBlock) => AccessLevel,
  templates: readonly AccessTemplate[],
): AccessTemplate | null {
  const own = templateBlocks(blocks);
  if (own.length === 0) return null;
  return (
    templates.find((template) =>
      own.every((block) => templateLevel(template, block) === levelOf(block)),
    ) ?? null
  );
}

/** Шаблон с одной правленой строкой (и сброшенными зависимыми). */
export function withTemplateChanges(
  template: Pick<AccessTemplate, "levels">,
  changes: readonly AccessChange[],
): Record<string, AccessLevel> {
  const next: Record<string, AccessLevel> = { ...template.levels };
  for (const change of changes) next[change.block] = change.level;
  return next;
}
