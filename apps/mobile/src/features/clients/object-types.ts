// СЛОВАРЬ ТИПОВ ОБЪЕКТА — ТОЛЬКО ТО, ЧТО ЗАВЁЛ САМ ЧЕЛОВЕК.
//
// Владелец 03.10: «удали все типы объектов — изначально их быть не должно,
// каждый человек сам создаёт свой тип объекта». До этого словарь собирался из
// трёх слоёв: справочник команды (Кабинет → «Типы объектов»), типы,
// встреченные на объектах клиентов, и стандартный набор «Дом · Квартира ·
// Офис». Два последних слоя снова приносили в выбор то, что человек удалил
// или никогда не заводил, — теперь словарь равен справочнику команды.
//
// Метка на объекте, которой в справочнике нет (тип удалили), объект типом
// не красит: он показывается как объект без типа (`findObjectType`).
// Заведут такой тип снова — объект подхватит его сам.

/** Ключ сравнения: «дом», «Дом» и «ДОМ » — один тип, а не три. */
export function objectTypeKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Словарь типов объекта для выбора — справочник команды в его порядке, без
 * пустых строк и без дублей по регистру. Порядок задаёт сам справочник,
 * поэтому выбор типа его не двигает: строка не уезжает из-под пальца.
 */
export function objectTypeVocabulary(presets: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of presets) {
    const name = raw.trim();
    if (!name) continue;
    const key = objectTypeKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Тип объекта из справочника по метке объекта; нет такого — `undefined`,
 *  и объект показывается без типа. */
export function findObjectType<T extends { name: string }>(
  presets: readonly T[],
  label: string | null | undefined,
): T | undefined {
  const key = objectTypeKey(label ?? "");
  if (!key) return undefined;
  return presets.find((preset) => objectTypeKey(preset.name) === key);
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
