// ТЕ ЖЕ ДАННЫЕ, ЧТО ДАЛ БЫ JSON — БЕЗ JSON (аудит Android 13.10).
//
// Сверка кэша с сервером сравнивала каждую строку двумя `JSON.stringify`: на
// списке в тысячи записей это тысячи больших строк на КАЖДУЮ сверку (возврат
// в приложение, событие realtime), и на Android JS-поток стоял, пока память
// забивалась временными строками. Здесь — прямой обход значений: та же
// граница «одинаково ли сериализуется», без единой выделенной строки.
//
// Совпадает с `JSON.stringify(a) === JSON.stringify(b)` для данных из JSON
// (строки, числа, булевы, null, массивы, объекты) с одной разницей в
// безопасную сторону: порядок ключей не важен (раньше другой порядок давал
// «отличается» и лишнюю перезапись). Ключ со значением `undefined` — как
// отсутствующий, ровно как в JSON.

export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    // NaN и бесконечности JSON пишет как null.
    if (typeof a === "number" && typeof b === "number") {
      return !Number.isFinite(a) && !Number.isFinite(b);
    }
    if (typeof a === "number" && !Number.isFinite(a)) return b === null;
    if (typeof b === "number" && !Number.isFinite(b)) return a === null;
    return false;
  }
  const arrA = Array.isArray(a);
  if (arrA !== Array.isArray(b)) return false;
  if (arrA) {
    const x = a as unknown[];
    const y = b as unknown[];
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) {
      // В массиве undefined JSON пишет как null.
      const xi = x[i] === undefined ? null : x[i];
      const yi = y[i] === undefined ? null : y[i];
      if (!sameJson(xi, yi)) return false;
    }
    return true;
  }
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  let countX = 0;
  for (const key in x) {
    if (!Object.prototype.hasOwnProperty.call(x, key)) continue;
    const v = x[key];
    if (v === undefined || typeof v === "function") continue;
    countX++;
    if (!sameJson(v, y[key])) return false;
  }
  let countY = 0;
  for (const key in y) {
    if (!Object.prototype.hasOwnProperty.call(y, key)) continue;
    const v = y[key];
    if (v === undefined || typeof v === "function") continue;
    countY++;
  }
  return countX === countY;
}
