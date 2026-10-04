import type { TeamDesign } from "./team-design";

// Лист без React и сети: колонки строки `team_design` и разница правки —
// их читает запись настроек команды и тест.

/** Колонки строки `team_design` из настроек команды. */
export function designColumns(design: TeamDesign): Record<string, unknown> {
  return {
    record_color_rule: design.rule,
    record_color_palette: design.palette,
    record_color_fallback: design.fallback,
    disabled_blocks: design.disabledBlocks,
    client_list_off: design.listOff ?? null,
    contact_ways: design.contactWays ?? null,
    map_services: design.mapServices ?? null,
  };
}

/** ТОЛЬКО ТО, ЧТО ПРАВКА МЕНЯЕТ (01.10). Строка одна на «Записи» и на
 *  настройки клиентов, и у каждой части своё право (`team_design_guard_columns`).
 *  Целая строка из кэша телефона несла бы и чужие колонки: у партнёра с
 *  правом только на «Способы связи» сервер отбил бы правку из-за старого цвета
 *  записей в кэше, а с правом и на «Записи» — молча вернул бы свежую правку
 *  владельца назад. Сравнение — с тем, что было на экране перед правкой. */
export function changedDesignColumns(before: TeamDesign, next: TeamDesign): Record<string, unknown> {
  const was = designColumns(before);
  const now = designColumns(next);
  const out: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(now)) {
    if (JSON.stringify(value) !== JSON.stringify(was[column])) out[column] = value;
  }
  return out;
}

/** Набор, который правят по одному элементу (тумблер блока, поле строки
 *  списка): на набор сервера ложатся добавленные и убранные элементы. */
function mergeSet<T extends string>(
  was: readonly T[] | null | undefined,
  now: readonly T[] | null | undefined,
  server: readonly T[] | null | undefined,
): T[] {
  const before = was ?? [];
  const after = now ?? [];
  const removed = new Set<T>(before.filter((x) => !after.includes(x)));
  const merged = (server ?? []).filter((x) => !removed.has(x));
  for (const x of after) if (!before.includes(x) && !merged.includes(x)) merged.push(x);
  return merged;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** ПРАВКА, СДЕЛАННАЯ ОТ УСТАРЕВШЕЙ ОСНОВЫ, ЛОЖИТСЯ НА СТРОКУ СЕРВЕРА (04.10).
 *
 *  Экран строит новое состояние от того, что показывал (`shown`). Если строки
 *  команды у телефона не было (страница открыта до ответа сервера, чтение
 *  упало, строку только что завёл другой телефон), `shown` — умолчания, и
 *  запись целой строкой затирала на сервере «Способы связи», «Карты»,
 *  поля списка и цвет записей. Теперь берётся строка сервера, и на неё
 *  ложится только то, что человек изменил: у наборов — добавленные и
 *  убранные элементы, у остального — новое значение изменённого поля. */
export function rebaseDesign(shown: TeamDesign, next: TeamDesign, server: TeamDesign): TeamDesign {
  return {
    rule: same(shown.rule, next.rule) ? server.rule : next.rule,
    palette: same(shown.palette, next.palette) ? server.palette : next.palette,
    fallback: same(shown.fallback, next.fallback) ? server.fallback : next.fallback,
    contactWays: same(shown.contactWays, next.contactWays) ? server.contactWays : next.contactWays,
    mapServices: same(shown.mapServices, next.mapServices) ? server.mapServices : next.mapServices,
    disabledBlocks: same(shown.disabledBlocks ?? [], next.disabledBlocks ?? [])
      ? server.disabledBlocks
      : mergeSet(shown.disabledBlocks, next.disabledBlocks, server.disabledBlocks),
    listOff: same(shown.listOff ?? [], next.listOff ?? [])
      ? server.listOff
      : mergeSet(shown.listOff, next.listOff, server.listOff),
  };
}
