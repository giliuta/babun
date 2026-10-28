import type { Client } from "@babun/shared/local/clients";
import { getAvatarColor } from "@babun/shared/common/utils/avatar-color";
import {
  clientPropertyTypes,
  propertyTypeLabel,
  type FacetOption,
} from "../filter";

// Facet option builders of the clients list: labels and object types.

/** Минимальная структурная форма команды — хук читает только id/name/
 *  color, так что подходят и shared Team, и Supabase-row из useTeams(). */
export interface TeamLike {
  id: string;
  name: string;
  color: string | null;
}

/** Минимальная форма метки библиотеки (cities) — имя+цвет, порядок массива
 *  = порядок библиотеки (useCities уже отдаёт по position). */
export interface CityLike {
  name: string;
  color: string | null;
}

/** Ключ типа объекта — тот же, по которому варианты схлопываются в фасет.
 *  ПО ПОДПИСИ, а не по сырому значению: старое `house` подписано «Дом», и
 *  рядом с живым «Дом» фильтр показывал два одинаковых «Дом». */
export function propertyKey(value: string): string {
  return propertyTypeLabel(value).trim().toLowerCase();
}

/** Label facet options: the whole library plus legacy free values. */
export function cityFacetOptions(clients: Client[], cities: CityLike[]): FacetOption[] {
  // ВСЯ библиотека меток Кабинета (порядок position, цвет метки) +
  // legacy-хвост: свободные значения client.city, не совпавшие с
  // библиотекой trim/case-insensitive, — по алфавиту с avatar-цветом.
  // «Прочее»-корзины нет: каждое значение — отдельный удаляемый токен.
  const used = new Map<string, string>(); // norm → как написано у клиента
  for (const c of clients) {
    const city = (c.city ?? "").trim();
    if (!city) continue;
    const norm = city.toLowerCase();
    if (!used.has(norm)) used.set(norm, city);
  }
  const options: FacetOption[] = [];
  // ОДНО ИМЯ — ОДИН ВАРИАНТ. Метка принадлежит команде, и у
  // каждой своя строка в справочнике: без схлопывания фильтр предлагал бы
  // «Лимассол» столько раз, сколько в компании календарей. У КЛИЕНТА
  // команды нет — его метка это просто имя, поэтому здесь имя и есть
  // единица выбора.
  const seenName = new Set<string>();
  for (const lib of cities) {
    const name = lib.name.trim();
    if (!name) continue;
    if (seenName.has(name.toLowerCase())) continue;
    seenName.add(name.toLowerCase());
    used.delete(name.toLowerCase());
    options.push({
      value: name,
      label: name,
      color: lib.color ?? getAvatarColor(name),
    });
  }
  const legacy = [...used.values()].sort((a, b) => a.localeCompare(b, "ru"));
  for (const city of legacy) {
    options.push({
      value: city,
      label: city,
      color: getAvatarColor(city),
      legacy: true,
    });
  }
  return options;
}

/** Object-type facet options, built from the values present in the data. */
export function propertyFacetOptions(clients: Client[]): FacetOption[] {
  // ИЗ ФАКТОВ, а не из зашитого перечисления. Строка выбора на объекте
  // пишет в `loc.label` живые слова бизнеса («Дом», «Склад», «Бокс»), а
  // фасет предлагал шесть значений старого enum'а (house/apartment/…) —
  // выбрать можно было только то, чего в данных нет, и фильтр честно
  // отдавал пустой список.
  //
  // Порядок: по частоте, при равенстве по алфавиту — как во всех фасетах,
  // где словарь принадлежит бизнесу, а не нам. Legacy-значения enum'а
  // переводятся в человеческую подпись и живут наравне.
  const uses = new Map<string, { value: string; count: number }>();
  for (const c of clients) {
    for (const value of clientPropertyTypes(c)) {
      const key = propertyKey(value);
      if (!key) continue;
      const prev = uses.get(key);
      if (prev) prev.count += 1;
      else uses.set(key, { value, count: 1 });
    }
  }
  return [...uses.values()]
    .sort(
      (a, b) =>
        b.count - a.count ||
        propertyTypeLabel(a.value).localeCompare(
          propertyTypeLabel(b.value),
          "ru",
        ),
    )
    .map(({ value }) => ({
      value,
      label: propertyTypeLabel(value),
      color: "",
    }));
}
