// Pure derivations of the clients list: merging rows of several companies,
// the data span for the period split, tag options per team and pruning of
// filter values that no longer exist.

import type { ClientsFilter } from "../filter";

/** Склейка без дублей: первая строка с этим id побеждает (своя компания
 *  идёт первой). */
export function uniqueById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

/** Первая и последняя (не отменённые) записи — сплит периода в фильтрах
 *  показывает у «Всего времени» честный охват данных в обе стороны. */
export function dataSpanOf(
  appointments: readonly { status: string; date: string | null }[],
): { from: string | null; to: string | null } {
  let min: string | null = null;
  let max: string | null = null;
  for (const a of appointments) {
    if (a.status === "cancelled" || !a.date) continue;
    if (!min || a.date < min) min = a.date;
    if (!max || a.date > max) max = a.date;
  }
  return { from: min, to: max };
}

/** ТЕГИ В ФИЛЬТРАХ — КОМАНДЫ (владелец 30.09: «теги закреплены за
 *  командой»): под чипом — её теги; без чипа — все, и одинаковые имена
 *  разных команд подписаны командой, иначе две «VIP» не различить. */
export function filterTagsFor<T extends { name: string; team_id?: string | null }>(
  tags: T[],
  teams: readonly { id: string; name: string }[],
  /** Выбранная команда; `null` — лента без чипа. */
  teamChoice: string | null,
): T[] {
  if (teamChoice !== null) {
    return tags.filter((tag) => !tag.team_id || tag.team_id === teamChoice);
  }
  const byName = new Map<string, number>();
  for (const tag of tags) {
    const key = tag.name.trim().toLowerCase();
    byName.set(key, (byName.get(key) ?? 0) + 1);
  }
  return tags.map((tag) => {
    const shared = (byName.get(tag.name.trim().toLowerCase()) ?? 0) > 1;
    const teamName = tag.team_id ? teams.find((tm) => tm.id === tag.team_id)?.name : null;
    return shared && teamName ? { ...tag, name: `${tag.name} · ${teamName}` } : tag;
  });
}

/** Прунинг «призрачных» фильтров: если тег/команду/метку удалили, пока
 *  фильтр по ним активен, список схлопнулся бы в ноль без токена для
 *  снятия. Держим выбранное подмножеством живых опций. Nothing to drop —
 *  the same object comes back, so the state setter bails out. */
export function pruneFilter(
  f: ClientsFilter,
  live: {
    teamOptions: readonly { value: string }[];
    tagOptions: readonly { value: string }[];
    cityOptions: readonly { value: string }[];
    sourceOptions: readonly { value: string }[];
    sourcesReady: boolean;
    tagsReady: boolean;
    /** Справочник меток пришёл и список клиентов тоже. */
    citiesLoaded: boolean;
  },
): ClientsFilter {
  const { teamOptions, tagOptions, cityOptions, sourceOptions, sourcesReady, tagsReady, citiesLoaded } = live;
  const teamSet = new Set(teamOptions.map((o) => o.value));
  const tagSet = new Set(tagOptions.map((o) => o.value));
  const citySet = new Set(cityOptions.map((o) => o.value));
  // Источники — только когда справочник пришёл: пока он в пути, живым
  // кажется одно «Неизвестно».
  const sourceSet = new Set(sourceOptions.map((o) => o.value));
  const sources = sourcesReady ? f.sources.filter((x) => sourceSet.has(x)) : f.sources;
  // Строки «Команда» в фильтрах с 30.09 нет — команду выбирает лента.
  // Забытый вчерашний выбор прятал бы клиентов без видимого токена.
  void teamSet;
  const selectedTeams: string[] = [];
  // Теги и метки — тоже только пришедшие: набор дня поднимается из памяти
  // на холодном старте раньше справочников, и пустой список стирал
  // вчерашние «VIP · Лимассол» до того, как они успевали загрузиться
  // (проверка 03.10).
  const activeTags = tagsReady ? f.activeTags.filter((x) => tagSet.has(x)) : f.activeTags;
  const selectedCities = citiesLoaded
    ? f.selectedCities.filter((x) => citySet.has(x))
    : f.selectedCities;
  if (
    selectedTeams.length === f.selectedTeams.length &&
    activeTags.length === f.activeTags.length &&
    selectedCities.length === f.selectedCities.length &&
    sources.length === f.sources.length
  )
    return f;
  return { ...f, selectedTeams, activeTags, selectedCities, sources };
}
