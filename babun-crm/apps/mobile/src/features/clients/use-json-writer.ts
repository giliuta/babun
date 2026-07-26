import { useCallback, useEffect, useRef } from "react";

// ЗАПИСЬ JSON-МАССИВА КЛИЕНТА — одна свежая правда и одна очередь.
//
// `phones`, `locations`, `notes` — каждый из них ОДНА jsonb-колонка: патч
// перезаписывает массив целиком, а не отдельное поле внутри него. Пока
// каждая строка собирала патч из снимка своего рендера, две быстрые правки
// подряд на медленной сети затирали друг друга: вторая уходила со ещё старым
// значением первой, применялась последней — и первая правка исчезала
// навсегда (invalidate подтягивал авторитетную строку и подтверждал потерю).
//
// Поэтому: (1) массив всегда берётся из `latest` — с сервера, а до его ответа
// наша собственная запись; (2) записи выстроены в цепочку, вторая уходит
// после ответа на первую.

export interface JsonArrayWriter<T> {
  /** Свежайший массив: серверный, либо наш ещё не подтверждённый. */
  current: () => T[];
  /** Записать новый массив (встанет в очередь). */
  commit: (next: T[]) => Promise<boolean>;
  /** Применить функцию к свежайшему массиву и записать результат. */
  apply: (fn: (items: T[]) => T[]) => Promise<boolean>;
}

export function useJsonArrayWriter<T>(
  items: T[],
  write: (next: T[]) => Promise<boolean>,
): JsonArrayWriter<T> {
  const latest = useRef<T[]>(items);
  // Рендер приносит авторитетное значение (в том числе после чужой правки по
  // реалтайму) — оно главнее нашего оптимистичного.
  useEffect(() => {
    latest.current = items;
  }, [items]);

  const chain = useRef<Promise<unknown>>(Promise.resolve());

  const commit = useCallback(
    (next: T[]): Promise<boolean> => {
      // Своё значение — правда до ответа сервера: следующая правка на этом же
      // экране должна видеть предыдущую, даже если запись ещё в пути.
      latest.current = next;
      const run = chain.current.then(() => write(next));
      chain.current = run.catch(() => false);
      return run;
    },
    [write],
  );

  const apply = useCallback(
    (fn: (list: T[]) => T[]) => commit(fn(latest.current)),
    [commit],
  );

  const current = useCallback(() => latest.current, []);

  return { current, commit, apply };
}
