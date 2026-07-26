import type { Client } from "@babun/shared/local/clients";

// СЛОВАРЬ ТИПОВ ОБЪЕКТА — собирается из ФАКТИЧЕСКИХ данных бизнеса.
//
// Владелец 2026-07-26: «дом офис вилла — это стандарт… можешь просто листать
// либо добавлять своё» и «продумаем для SaaS»: у автомойки типы свои, у
// кондиционерщиков свои, и заводиться они должны сами по ходу работы.
//
// Почему не таблица кабинета: `location_labels` в базе НЕТ — миграция,
// создающая её, не применена к проекту, а у чтения стоит заглушка «нет
// таблицы → отдай локальный кэш». То есть значения, введённые в кабинете,
// живут только на одном телефоне и не синхронизируются. Опираться на это
// нельзя; опираемся на то, что есть всегда — сами объекты клиентов.
//
// Порядок словаря = порядок пользы: сначала то, чем бизнес реально пользуется
// (по частоте), потом стандартный набор. Так у кондиционерщика первым будет
// «Квартира», а не наш «Дом».

/** Стандартный набор — ровно тот, что назвал владелец. */
export const STANDARD_OBJECT_TYPES = ["Дом", "Офис", "Вилла"] as const;

/** Ключ сравнения: «дом», «Дом» и «ДОМ » — один тип, а не три. */
export function objectTypeKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Словарь типов объекта для пикера: сначала используемые бизнесом (по
 * убыванию частоты, при равенстве — по алфавиту), затем стандартные, которых
 * бизнес ещё не использовал. Без дублей по регистру и пробелам.
 *
 * @param extra — значения, которые нужно показать обязательно: пресеты
 *   кабинета (если таблица однажды появится) и текущее значение объекта,
 *   даже если оно больше нигде не встречается.
 */
export function objectTypeVocabulary(
  clients: readonly Client[],
  extra: readonly string[] = [],
): string[] {
  const uses = new Map<string, { name: string; count: number }>();

  const add = (raw: string | undefined | null, weight: number) => {
    const name = (raw ?? "").trim();
    if (!name) return;
    const key = objectTypeKey(name);
    const prev = uses.get(key);
    // Написание берём от первого встреченного: не «нормализуем» чужой язык.
    if (prev) prev.count += weight;
    else uses.set(key, { name, count: weight });
  };

  for (const client of clients) {
    for (const loc of client.locations ?? []) add(loc.label, 1);
  }
  // Обязательные значения весят 0: попадают в список, но не поднимаются выше
  // того, чем реально пользуются.
  for (const name of extra) add(name, 0);

  const used = [...uses.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ru"))
    .map((u) => u.name);

  const seen = new Set(used.map(objectTypeKey));
  const standard = STANDARD_OBJECT_TYPES.filter(
    (name) => !seen.has(objectTypeKey(name)),
  );

  return [...used, ...standard];
}

/** Приводит введённое значение к уже существующему написанию: «дом» → «Дом».
 *  Иначе словарь бизнеса зарастал бы вариантами одного и того же слова. */
export function snapObjectType(
  raw: string,
  vocabulary: readonly string[],
): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) return "";
  const key = objectTypeKey(name);
  return vocabulary.find((v) => objectTypeKey(v) === key) ?? name;
}

/** Тип, который подставляется НОВОМУ объекту, чтобы обычный объект
 *  заводился, не касаясь этой строки: тип основного объекта того же клиента →
 *  первый тип словаря → «Дом». Значение-заглушка «Объект» за тип не считаем. */
export function defaultObjectType(
  client: { locations?: { label?: string; isPrimary?: boolean }[] } | null
    | undefined,
  vocabulary: readonly string[],
): string {
  const locs = client?.locations ?? [];
  const own = (locs.find((l) => l.isPrimary) ?? locs[0])?.label?.trim();
  if (own && objectTypeKey(own) !== "объект") return own;
  return vocabulary[0] ?? STANDARD_OBJECT_TYPES[0];
}
