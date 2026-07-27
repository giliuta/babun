import { useRef } from "react";
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

/** Стандартный набор — ровно тот, что назвал владелец 2026-07-27. «Вилла»
 *  убрана им же: «дом и вилла по сути одно и то же». */
export const STANDARD_OBJECT_TYPES = ["Дом", "Квартира", "Офис"] as const;

/** Ключ сравнения: «дом», «Дом» и «ДОМ » — один тип, а не три. */
export function objectTypeKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Словарь типов объекта для строки выбора.
 *
 * ПОРЯДОК НЕ ЗАВИСИТ ОТ ВЫБОРА. Это не украшение, а исправление бага, который
 * владелец увидел первым же тапом (2026-07-27: «нажимаю офис — оно
 * перекладывает на виллу»): раньше текущее значение подмешивалось в сортировку
 * по частоте, поэтому в момент выбора список пересобирался и чип уезжал
 * из-под пальца — выбранным оказывался сосед.
 *
 * Порядок: (1) типы, заведённые бизнесом в настройках, в их порядке;
 * (2) фактически используемые, которых в настройках нет, по убыванию частоты;
 * (3) стандартный набор, если он ещё не покрыт; (4) текущее значение объекта,
 * если его нет нигде — оно ДОПИСЫВАЕТСЯ в конец и ничего не двигает.
 *
 * @param presets — типы из настроек (кабинет), в порядке настроек.
 * @param current — текущее значение объекта: показать обязательно.
 */
export function objectTypeVocabulary(
  clients: readonly Client[],
  presets: readonly string[] = [],
  current?: string,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | undefined | null) => {
    const name = (raw ?? "").trim();
    if (!name) return;
    const key = objectTypeKey(name);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(name);
  };

  for (const preset of presets) push(preset);

  // Используемые — по частоте, при равенстве по алфавиту. Считаем ВСЕГДА от
  // объектов клиентов и никогда от текущего выбора.
  const uses = new Map<string, { name: string; count: number }>();
  for (const client of clients) {
    for (const loc of client.locations ?? []) {
      const name = (loc.label ?? "").trim();
      if (!name) continue;
      const key = objectTypeKey(name);
      const prev = uses.get(key);
      // Написание берём от первого встреченного: не «нормализуем» чужой язык.
      if (prev) prev.count += 1;
      else uses.set(key, { name, count: 1 });
    }
  }
  [...uses.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ru"))
    .forEach((u) => push(u.name));

  for (const name of STANDARD_OBJECT_TYPES) push(name);
  push(current);

  return out;
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

/**
 * ЗАМОРОЖЕННЫЙ словарь на время жизни экрана.
 *
 * Порядок словаря не зависит от текущего значения — но он зависит от ЧАСТОТ, а
 * тап по чипу переписывает метку объекта, то есть меняет сами данные, из
 * которых частоты считаются. Второй контур обратной связи: чип снова уезжает
 * из-под пальца, просто через базу.
 *
 * Поэтому экран считает порядок ОДИН раз и дальше только дописывает в хвост
 * то, чего в нём ещё не было. Список, по которому человек уже целится пальцем,
 * не имеет права перестраиваться под ним ни от чего.
 */
export function useFrozenObjectTypes(
  clients: readonly Client[],
  presets: readonly string[],
  current: string | undefined,
): string[] {
  const frozen = useRef<string[] | null>(null);
  const seeded = useRef(false);

  // Первый непустой расчёт и есть порядок на всю жизнь экрана. До прихода
  // клиентов список ещё не «настоящий», поэтому ждём данные.
  if (!seeded.current) {
    const first = objectTypeVocabulary(clients, presets, current);
    if (clients.length > 0 || presets.length > 0 || first.length > 0) {
      frozen.current = first;
      seeded.current = clients.length > 0 || presets.length > 0;
    }
  }

  const base = frozen.current ?? objectTypeVocabulary(clients, presets, current);
  const name = (current ?? "").trim();
  if (!name) return base;
  const key = objectTypeKey(name);
  if (base.some((v) => objectTypeKey(v) === key)) return base;
  const next = [...base, name];
  frozen.current = next;
  return next;
}
