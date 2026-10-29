// Pure words and numbers of the «Фильтры» sheet: row summaries, the
// zero-result hint, the active-set summary under the title and the period
// split. No React here — the sheet only lays them out.

import { countWordRu } from "@babun/shared/common/utils/pluralize";
import { formatYMD } from "@/features/appointments/helpers";
import { periodDates } from "@/lib/period";
import {
  periodLabel,
  propertyTypeLabel,
  SEGMENT_OPTIONS,
  type ClientsFilter,
  type FacetOption,
} from "../filter";

/** Сводка строки: первый выбранный ПО КАНОНИЧЕСКОМУ ПОРЯДКУ + «+K». */
export function summarize(
  options: { value: string; label: string; color?: string }[],
  selected: string[],
): { label: string; extra: number; color?: string } | null {
  if (selected.length === 0) return null;
  const chosen = options.filter((o) => selected.includes(o.value));
  if (chosen.length === 0) return null;
  return {
    label: chosen[0].label,
    extra: chosen.length - 1,
    color: chosen[0].color,
  };
}

export const toggleIn = (list: string[], v: string) =>
  list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

/** Кто виноват в нуле: считаем по leave-one-out из того же прохода, что и
 *  счётчики. Одна формула на страницу и на попап. */
export function zeroHintFor(
  shownCount: number,
  withoutOne: Record<string, number>,
  filter: ClientsFilter,
  trimmedSearch: string,
): string | null {
  if (shownCount > 0) return null;
  const w = withoutOne;
  // Имя в кавычках — как строка в листе, в именительном: «Без «метку»»
  // читалось бы сбоем.
  const names: Record<string, string> = {
    search: "Поиск",
    period: "Период",
    segment: "Статус",
    city: "Метка",
    tag: "Теги",
    team: "Команда",
    source: "Источник",
    property: "Тип объекта",
  };
  const active: Record<string, boolean> = {
    search: !!trimmedSearch,
    period: !!filter.period,
    segment: filter.segments.length > 0,
    city: filter.selectedCities.length > 0,
    tag: filter.activeTags.length > 0,
    team: filter.selectedTeams.length > 0,
    source: filter.sources.length > 0,
    property: filter.propertyTypes.length > 0,
  };
  let best: { key: string; n: number } | null = null;
  for (const key of Object.keys(names)) {
    if (!active[key]) continue;
    const n = w[key] ?? 0;
    if (n > 0 && (!best || n > best.n)) best = { key, n };
  }
  if (!best) return "Ничего не найдено — снимите условия";
  return `Без «${names[best.key]}» — ${best.n} ${countWordRu(best.n, "клиент", "клиента", "клиентов")}`;
}

/** «Возле названия видно, что выбрано»: компактная сводка активного
 *  набора под заголовком — единственный композитный взгляд, когда
 *  строки накрыты попапом. Порядок групп = порядок строк. */
export function activeSummaryOf({
  filter,
  search,
  nothingActive,
  tagOptions,
  teamOptions,
  sourceOptions,
}: {
  filter: ClientsFilter;
  search: string;
  nothingActive: boolean;
  tagOptions: FacetOption[];
  teamOptions: FacetOption[];
  sourceOptions: FacetOption[];
}): string | null {
  const searchNote = search.trim() ? `Поиск: «${search.trim()}»` : null;
  return nothingActive && !searchNote
    ? null
    : [
        // Поиск участвует во ВСЕХ числах листа — если он не виден,
        // «Показать 0» выглядит необъяснимым.
        ...(searchNote ? [searchNote] : []),
        ...(filter.period ? [periodLabel(filter.period)] : []),
        ...filter.segments.map(
          (k) => SEGMENT_OPTIONS.find((o) => o.key === k)?.label ?? k,
        ),
        ...filter.selectedCities,
        ...filter.activeTags
          .map((id) => tagOptions.find((o) => o.value === id)?.label ?? "")
          .filter(Boolean),
        ...filter.selectedTeams
          .map((id) => teamOptions.find((o) => o.value === id)?.label ?? "")
          .filter(Boolean),
        ...filter.sources
          .map((s) => sourceOptions.find((o) => o.value === s)?.label ?? "")
          .filter(Boolean),
        ...filter.propertyTypes.map(propertyTypeLabel).filter(Boolean),
      ].join(" · ");
}

/** Сплит периода (диалект Финансов): слева имя, справа всегда даты —
 *  у «Всего времени» это честный охват данных «с первой записи по
 *  сегодня». Тот же диапазон сидит и в колёсах, и в подсказке попапа. */
export function periodSplit(
  period: ClientsFilter["period"],
  dataFrom: string | null,
  dataTo: string | null,
  now: Date,
): {
  allSpanDates: string | null;
  periodName: string;
  datesLabel: string;
  draftFrom: string;
  draftTo: string;
} {
  const todayYmd = formatYMD(now);
  // Охват данных честен в обе стороны: у тенанта с записями только в
  // будущем «Всё время» — это «сегодня — последняя запись», а не «сегодня».
  const spanFrom = dataFrom && dataFrom < todayYmd ? dataFrom : todayYmd;
  const spanTo = dataTo && dataTo > todayYmd ? dataTo : todayYmd;
  const allSpanDates =
    dataFrom || dataTo
      ? periodDates({ preset: "custom", from: spanFrom, to: spanTo })
      : null;
  const periodName = period ? periodLabel(period) : "Всё время";
  // «ВСЁ ВРЕМЯ» — БЕЗ ДАТ РЯДОМ: охват данных справа читался как выбранный
  // период. Правая половина — дверь к колёсам, и подписана она словом.
  const datesLabel = period ? periodDates(period) : "Даты";
  const draftFrom =
    period?.from ??
    (dataFrom && dataFrom < todayYmd
      ? dataFrom
      : formatYMD(new Date(now.getFullYear(), now.getMonth(), 1)));
  const draftTo = period?.to ?? todayYmd;
  return { allSpanDates, periodName, datesLabel, draftFrom, draftTo };
}
