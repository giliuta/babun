// ГРАНИЦЫ `memo` В СЕТКЕ КАЛЕНДАРЯ — ЧИСТЫЕ СРАВНЕНИЯ ПРОПСОВ.
//
// Смена календаря и любое постороннее обновление экрана (флаги запросов,
// тост, режим переноса) перерисовывали всю смонтированную неделю: три
// страницы пейджера по семь колонок и полторы сотни блоков — хотя данные
// колонки не менялись. `memo` с поверхностным сравнением спасает не всё:
// часть пропсов по построению приходит НОВЫМ объектом с тем же содержимым.
//
//   • `workBand` — резолвер графика собирает объект полосы на каждый вызов;
//   • `appointments` — у пустого дня `apptsFor` отдаёт свежий `[]`, а после
//     переноса одной записи карта дат пересобирается целиком, и массивы
//     остальных шести дней новые, хотя элементы в них те же самые;
//   • `placed` — раскладка дня пересоздаёт объекты размещения всех блоков
//     колонки, когда в ней сдвинулась одна запись.
//
// Здесь только эти три случая сравниваются по содержимому; всё остальное —
// по ссылке, как у обычного `memo`. Резолверы, которые колонка зовёт во
// время отрисовки (`clientName`, `teamColorFor`…), по содержимому НЕ
// сравниваются: их смена и есть сигнал «имена или цвета стали другими».
//
// Файл без React и react-native: раннер тестов поднимает его как есть.

type MinuteRange = { startMin: number; endMin: number };
type Band =
  | (MinuteRange & { breaks?: readonly MinuteRange[] })
  | null
  | undefined;

/** Одна и та же рабочая полоса дня. `null` (выходной) и `undefined` (графика
 *  не знаем) — РАЗНЫЕ ответы: колонка красит их по-разному. */
export function sameWorkBand(a: Band, b: Band): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.startMin !== b.startMin || a.endMin !== b.endMin) return false;
  const ab = a.breaks ?? [];
  const bb = b.breaks ?? [];
  if (ab.length !== bb.length) return false;
  return ab.every(
    (x, i) => x.startMin === bb[i].startMin && x.endMin === bb[i].endMin,
  );
}

/** Те же элементы в том же порядке. Элементы — по ссылке: оптимистичный
 *  перенос кладёт в кэш НОВЫЙ объект записи (`{ ...a, ...patch }`), так что
 *  изменённая запись всегда отличается ссылкой. `undefined` и `[]` разные:
 *  у `freeSlots` пустой массив значит «режим подбора, свободного нет». */
export function sameItems<T>(
  a: readonly T[] | undefined,
  b: readonly T[] | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Поверхностное равенство двух объектов по всем ключам. Для размещения
 *  блока: все поля — примитивы и ссылка на запись. Сравниваются ВСЕ ключи, а
 *  не перечисленные руками: поле, добавленное в раскладку завтра, не
 *  проскочит мимо сравнения. */
export function sameShallow(a: object, b: object): boolean {
  if (a === b) return true;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = Object.keys(ra);
  if (keys.length !== Object.keys(rb).length) return false;
  return keys.every((k) => Object.is(ra[k], rb[k]));
}

type ValueEq = (a: never, b: never) => boolean;

/** Сравнение пропсов для `memo`: ключи из `byContent` — своей функцией,
 *  остальные — `Object.is`, как у самого React. */
export function propsEqualWith(byContent: Readonly<Record<string, ValueEq>>) {
  return <P extends object>(prev: Readonly<P>, next: Readonly<P>): boolean => {
    const a = prev as Record<string, unknown>;
    const b = next as Record<string, unknown>;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (Object.is(a[k], b[k])) continue;
      const eq = byContent[k] as
        | ((x: unknown, y: unknown) => boolean)
        | undefined;
      if (!eq || !eq(a[k], b[k])) return false;
    }
    return true;
  };
}

export const dayColumnPropsEqual = propsEqualWith({
  appointments: sameItems,
  workBand: sameWorkBand,
  freeSlots: sameItems,
});

export const blockPropsEqual = propsEqualWith({
  placed: sameShallow,
});

/** Вызов, который ВСЕГДА идёт в последнюю положенную в коробку функцию.
 *  Держатель ссылки стабилен, а замыкание внутри — свежее: мемоизированный
 *  блок, отпущенный пальцем через минуту, переносит запись с сегодняшними
 *  данными экрана, а не с теми, что были при его последней отрисовке. */
export function latestCaller<A extends unknown[], R>(box: {
  readonly current: (...args: A) => R;
}): (...args: A) => R {
  return (...args: A) => box.current(...args);
}
