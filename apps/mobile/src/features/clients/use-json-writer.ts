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

/** Общая очередь одного массива одного клиента. Карточка и страница «Все
 *  объекты» / «Все реквизиты» монтируют СВОИ блоки на один и тот же массив,
 *  а карточка при переходе не размонтируется: две очереди в ref-ах двух
 *  экземпляров затирали друг друга (аудит 23.09: заметка объекта, ещё
 *  летящая с карточки, пропадала после правки на странице). Поэтому при
 *  известном хозяине и поле очередь — модульная, одна на процесс, как у
 *  связей (`use-link-writer.ts`). */
interface WriterState<T> {
  latest: T[];
  pending: number;
  chain: Promise<unknown>;
}
const SHARED = new Map<string, WriterState<unknown>>();

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
  /** Какой это массив клиента (`locations`, `requisites`). Вместе с хозяином
   *  делает очередь общей для всех экранов процесса. */
  field?: string,
): JsonArrayWriter<T> {
  const sharedKey = ownerKey && field ? `${field}:${ownerKey}` : null;
  const local = useRef<WriterState<T>>({ latest: items, pending: 0, chain: Promise.resolve() });
  const pick = (): WriterState<T> => {
    if (!sharedKey) return local.current;
    let state = SHARED.get(sharedKey) as WriterState<T> | undefined;
    if (!state) {
      state = { latest: items, pending: 0, chain: Promise.resolve() };
      SHARED.set(sharedKey, state as WriterState<unknown>);
    }
    return state;
  };
  const store = pick();
  const storeRef = useRef(store);
  storeRef.current = store;

  const owner = useRef(ownerKey);
  useEffect(() => {
    if (owner.current === ownerKey) return;
    owner.current = ownerKey;
    // Своя очередь у нового хозяина: локальную сбрасываем, общая уже своя.
    if (!sharedKey) {
      local.current.latest = items;
      local.current.pending = 0;
    }
  }, [ownerKey, items, sharedKey]);
  // Рендер приносит авторитетное значение (в том числе после чужой правки по
  // реалтайму) — оно главнее нашего оптимистичного, но только когда своих
  // незавершённых записей нет. Пока хоть одна в пути, рендеру верить НЕЛЬЗЯ:
  // инвалидация после первой записи запускает чтение, которое на медленной
  // сети отвечает УЖЕ ПОСЛЕ второй записи и приносит массив без неё.
  useEffect(() => {
    const st = storeRef.current;
    if (st.pending === 0) st.latest = items;
  }, [items]);

  const commit = useCallback(
    (next: T[]): Promise<boolean> => {
      const st = storeRef.current;
      // Своё значение — правда до ответа сервера: следующая правка на этом же
      // экране должна видеть предыдущую, даже если запись ещё в пути.
      const prev = st.latest;
      st.latest = next;
      // НЕУДАЧНАЯ запись откатывает оптимистичное значение. Иначе фантом
      // оставался в latest и уезжал в базу со СЛЕДУЮЩЕЙ удачной записью —
      // например, удалённый номер воскресал вместе с правкой соседнего.
      // Откатываем только если поверх ничего не успели написать.
      const rollback = () => {
        if (st.latest === next) st.latest = prev;
      };
      st.pending += 1;
      const settle = () => {
        // Не ниже нуля: смена хозяина обнуляет счётчик, а запись прошлого
        // хозяина отвечает позже.
        st.pending = Math.max(0, st.pending - 1);
      };
      const run = st.chain.then(() => write(next)).then(
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
      st.chain = run;
      return run;
    },
    [write],
  );

  const apply = useCallback(
    (fn: (list: T[]) => T[]) => commit(fn(storeRef.current.latest)),
    [commit],
  );

  const current = useCallback(() => storeRef.current.latest, []);

  return { current, commit, apply };
}
