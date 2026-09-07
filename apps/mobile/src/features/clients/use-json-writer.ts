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
  /** Чей это массив. Писатель на карточке живёт с одним клиентом, а на
   *  форме записи клиента меняют под ним — и запись прошлого клиента,
   *  ещё летящая на сервер, держала бы `pending` и его массив в «свежайшем»:
   *  первая правка нового клиента уезжала бы поверх списка старого
   *  (ревью 2026-09-04). Смена хозяина — новая правда: массив нового, очередь
   *  прошлого доживает в своих замыканиях и на новую правду не влияет. */
  ownerKey?: string | null,
): JsonArrayWriter<T> {
  const latest = useRef<T[]>(items);
  // Сколько наших записей ещё в пути. Пока хоть одна не ответила, рендеру
  // верить НЕЛЬЗЯ: инвалидация после первой записи запускает чтение, которое
  // на медленной сети отвечает УЖЕ ПОСЛЕ второй записи и приносит массив без
  // неё. Раньше такой ответ безусловно ложился в latest, и третья запись
  // считалась от него — только что добавленный объект исчезал навсегда.
  const pending = useRef(0);
  const owner = useRef(ownerKey);
  useEffect(() => {
    if (owner.current === ownerKey) return;
    owner.current = ownerKey;
    latest.current = items;
    pending.current = 0;
  }, [ownerKey, items]);
  // Рендер приносит авторитетное значение (в том числе после чужой правки по
  // реалтайму) — оно главнее нашего оптимистичного, но только когда своих
  // незавершённых записей нет.
  useEffect(() => {
    if (pending.current === 0) latest.current = items;
  }, [items]);

  const chain = useRef<Promise<unknown>>(Promise.resolve());

  const commit = useCallback(
    (next: T[]): Promise<boolean> => {
      // Своё значение — правда до ответа сервера: следующая правка на этом же
      // экране должна видеть предыдущую, даже если запись ещё в пути.
      const prev = latest.current;
      latest.current = next;
      // НЕУДАЧНАЯ запись откатывает оптимистичное значение. Иначе фантом
      // оставался в latest и уезжал в базу со СЛЕДУЮЩЕЙ удачной записью —
      // например, удалённый номер воскресал вместе с правкой соседнего.
      // Откатываем только если поверх ничего не успели написать.
      const rollback = () => {
        if (latest.current === next) latest.current = prev;
      };
      pending.current += 1;
      const settle = () => {
        // Не ниже нуля: смена хозяина обнуляет счётчик, а запись прошлого
        // хозяина отвечает позже.
        pending.current = Math.max(0, pending.current - 1);
      };
      const run = chain.current.then(() => write(next)).then(
        (ok) => {
          if (!ok) rollback();
          settle();
          return ok;
        },
        () => {
          rollback();
          settle();
          return false;
        },
      );
      chain.current = run;
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
