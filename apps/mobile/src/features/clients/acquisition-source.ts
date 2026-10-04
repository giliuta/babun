import {
  ACQUISITION_LABELS,
  type AcquisitionSource,
  type ClientSourceValue,
} from "@babun/shared/local/clients";
import { tDynamic } from "@babun/shared/i18n/runtime";
import { pluralRu } from "@babun/shared/common/utils/plural-ru";

// ИСТОЧНИК КЛИЕНТА — СПРАВОЧНИК КОМАНДЫ (владелец 03.10: «сделай просто
// стандартные источники, такие, какие я могу править; не нужен Instagram —
// могу его вообще удалить; и добавлять новые»).
//
// Все источники — строки `client_sources` команды. Восемь готовых засеваются
// каждой команде при рождении (`key` помнит, каким готовым строка была), и
// дальше ничем не отличаются от своих. Клиент хранит выбор как `src:<id>`.
//
// Старое значение — ключ готового (`instagram`, импорт пишет `other`) —
// читается строкой своей команды с тем же `key`. Источник, которого больше
// нет (удалён), читается как «не указан».
//
// Лист без React — правила проверяются тестом напрямую.

export interface ClientSource {
  id: string;
  tenant_id: string;
  team_id: string;
  name: string;
  position: number;
  /** Каким готовым вариантом строка засеяна; у своих — `null`. */
  key: AcquisitionSource | null;
}

export interface SourceOption {
  value: ClientSourceValue;
  label: string;
  source: ClientSource;
}

const CUSTOM_PREFIX = "src:";

export function customSourceValue(id: string): ClientSourceValue {
  return `${CUSTOM_PREFIX}${id}`;
}

/** id строки из значения клиента; у старых ключей — `null`. */
export function customSourceId(value: string | null | undefined): string | null {
  if (!value || !value.startsWith(CUSTOM_PREFIX)) return null;
  const id = value.slice(CUSTOM_PREFIX.length);
  return id ? id : null;
}

/** Источники команды в порядке справочника: позиция, потом имя. */
export function teamSources(sources: ClientSource[], teamId: string | null): ClientSource[] {
  return sources
    .filter((s) => s.team_id === teamId)
    .sort(
      (a, b) =>
        a.position - b.position ||
        a.name.localeCompare(b.name, "ru", { sensitivity: "base" }),
    );
}

/** Строка справочника за значением клиента или `null` — источник не указан
 *  или его больше нет. Старый ключ ищется у команды клиента; без команды —
 *  у любой. */
export function resolveSource(
  value: string | null | undefined,
  sources: ClientSource[],
  teamId: string | null | undefined,
): ClientSource | null {
  if (!value || value === "unknown") return null;
  const id = customSourceId(value);
  if (id) return sources.find((s) => s.id === id) ?? null;
  if (!(value in ACQUISITION_LABELS)) return null;
  return (
    sources.find((s) => s.key === value && (!teamId || s.team_id === teamId)) ?? null
  );
}

/** Значение клиента для фильтра и отметки в шторке: строка — `src:<id>`,
 *  иначе «unknown». */
export function normalizeSource(
  value: string | null | undefined,
  sources: ClientSource[],
  teamId: string | null | undefined,
): ClientSourceValue {
  const row = resolveSource(value, sources, teamId);
  return row ? customSourceValue(row.id) : "unknown";
}

/** ИМЯ ИСТОЧНИКА НА ЭКРАНЕ. Восемь готовых строк засевает сервер по-русски
 *  («Рекомендация», «Сайт» …); у засеянной строки есть `key`, и её имя
 *  переводится при показе. Своё имя человека — как написано. Хранится и
 *  сравнивается всегда исходное имя (корзина фильтра, поиск). */
export function sourceDisplayName(source: Pick<ClientSource, "key" | "name">): string {
  return source.key ? tDynamic(source.name) : source.name;
}

/** Подпись источника клиента; `null` — не указан. */
export function sourceLabel(
  value: string | null | undefined,
  sources: ClientSource[],
  teamId: string | null | undefined,
): string | null {
  const row = resolveSource(value, sources, teamId);
  return row ? sourceDisplayName(row) : null;
}

/** «Кто привёл» — у строки, засеянной «Рекомендацией», как её ни назови. */
export function isReferral(
  value: string | null | undefined,
  sources: ClientSource[],
  teamId: string | null | undefined,
): boolean {
  return resolveSource(value, sources, teamId)?.key === "referral";
}

/** Варианты выбора на карточке — источники команды клиента. */
export function sourcePickerOptions(
  sources: ClientSource[],
  teamId: string | null,
): SourceOption[] {
  return teamSources(sources, teamId).map((s) => ({
    value: customSourceValue(s.id),
    label: sourceDisplayName(s),
    source: s,
  }));
}

/** КОРЗИНА ФИЛЬТРА — ИМЯ ИСТОЧНИКА. У каждой команды своя строка
 *  «Instagram», а в фильтре «всех команд» это один вариант: клиент попадает
 *  в корзину по имени своей строки, без строки — в «Неизвестно». */
export function sourceBucket(
  value: string | null | undefined,
  sources: ClientSource[],
  teamId: string | null | undefined,
): string {
  const row = resolveSource(value, sources, teamId);
  return row ? `n:${row.name.trim().toLowerCase()}` : "unknown";
}

/** Варианты фильтра: имена источников (под чипом — только его команды) в
 *  порядке справочника, «Неизвестно» — последним. */
export function sourceFilterOptions(
  sources: ClientSource[],
  teamId: string | null = null,
): { value: string; label: string; color: string }[] {
  const ordered = (teamId ? sources.filter((s) => s.team_id === teamId) : [...sources]).sort(
    (a, b) =>
      a.position - b.position ||
      a.name.localeCompare(b.name, "ru", { sensitivity: "base" }),
  );
  const seen = new Set<string>();
  const out: { value: string; label: string; color: string }[] = [];
  for (const s of ordered) {
    const value = `n:${s.name.trim().toLowerCase()}`;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push({ value, label: sourceDisplayName(s).trim(), color: "" });
  }
  out.push({ value: "unknown", label: ACQUISITION_LABELS.unknown, color: "" });
  return out;
}

/** Подпись строки «Источники» в шестерёнке. */
export function sourcesSummary(n: number): string {
  if (n === 0) return "Источников нет";
  // Форма числа — общим правилом: на других языках интерфейса «21» уже не «один».
  const word = pluralRu(n, ["источник", "источника", "источников"]);
  return `${n} ${word}`;
}
