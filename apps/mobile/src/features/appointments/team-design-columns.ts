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
