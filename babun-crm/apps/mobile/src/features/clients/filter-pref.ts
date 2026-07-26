import { getStorage } from "@babun/shared/storage";
import { makePeriod } from "@/features/finances/period";
import { EMPTY_FILTER, todayYMD, type ClientsFilter } from "./filter";

// ОДИН живой набор фильтров, переживающий выход из приложения — и ничего
// больше: ни имён, ни списка сохранённых наборов (те владелец отклонил).
// Зачем: рабочий поток штатно выбрасывает из приложения — `tel:` звонок,
// SMS, WhatsApp, массовая рассылка. Возвращаешься — набор собран заново
// руками, шесть тапов на каждый круг обзвона.
//
// ДНЕВНОЙ ШТАМП: набор восстанавливается ТОЛЬКО если сохранён сегодня.
// Вчерашний список должников физически не может залипнуть на новое утро,
// а пресетный период («Сегодня», «Текущая неделя») пересобирается заново
// — в фильтре лежат абсолютные даты, и за ночь они протухают.

const KEY = "babun-clients-filter-day";

interface Stored {
  ymd: string;
  filter: ClientsFilter;
}

/** Набор сегодняшнего дня или null. Никогда не бросает: настройка — не
 *  повод ронять экран. */
export function loadDayFilter(): ClientsFilter | null {
  try {
    const raw = getStorage().get<Stored>(KEY);
    if (!raw || raw.ymd !== todayYMD()) return null;
    const f = raw.filter;
    if (!f || typeof f !== "object") return null;
    const period =
      f.period && f.period.preset !== "custom"
        ? // Пресет пересобираем от сегодняшней даты, иначе «Сегодня»
          // означало бы вчера.
          makePeriod(f.period.preset)
        : (f.period ?? null);
    return {
      ...EMPTY_FILTER,
      ...f,
      period,
      // Массивы восстанавливаем строго массивами: чужой/битый JSON не
      // должен доехать до предикатов.
      segments: Array.isArray(f.segments) ? f.segments : [],
      selectedTeams: Array.isArray(f.selectedTeams) ? f.selectedTeams : [],
      selectedCities: Array.isArray(f.selectedCities) ? f.selectedCities : [],
      activeTags: Array.isArray(f.activeTags) ? f.activeTags : [],
      sources: Array.isArray(f.sources) ? f.sources : [],
      propertyTypes: Array.isArray(f.propertyTypes) ? f.propertyTypes : [],
    };
  } catch {
    return null;
  }
}

export function saveDayFilter(filter: ClientsFilter): void {
  try {
    getStorage().set(KEY, { ymd: todayYMD(), filter } satisfies Stored);
  } catch {
    // Запись best-effort.
  }
}
