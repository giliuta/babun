import { useCallback, useEffect, useRef, useState } from "react";

// ЗАМЕТКА ПРЯМО В ФОРМЕ, А НЕ ЗА ТАПОМ (владелец 2026-09-04: «просто
// мини-блок, куда можно вписывать сразу — как в самом низу»). Заметка клиента
// и заметка объекта живут не в записи, а в клиенте и в объекте, поэтому поле
// пишет туда само: когда уходят с поля, когда у поля меняется хозяин (выбрали
// другого клиента или объект), когда экран уходит и перед сохранением
// записи. Пока печатают, свежее значение с сервера черновик не перетирает.
//
// ЧЕТЫРЕ ПРАВИЛА, КАЖДОЕ — ЗА НАЙДЕННЫЙ БАГ (ревью 2026-09-04):
// 1. Пишем только ТРОНУТЫЙ черновик. Нетронутое поле, пока стояло в фокусе,
//    затирало бы чужую свежую правку своим старым текстом.
// 2. Один и тот же текст не пишем дважды. Коммит зовут и «Создать запись»,
//    и уход экрана следом — и стёртое поле снимало из журнала две записи
//    вместо одной.
// 3. Черновик привязан к КЛЮЧУ (id записи журнала): стёр — снялась именно
//    она; набрал заново — родилась новая, а не переписалась соседняя.
// 4. Явный отказ («Закрыть без сохранения») черновик выбрасывает — иначе
//    диалог обещал бы одно, а форма делала другое.
//
// СМЕНА ХОЗЯИНА ДОПИСЫВАЕТ СТАРОМУ. Cleanup эффекта по `ownerKey` зовёт
// `commit` ПРОШЛОГО рендера — тот, что замкнул старого хозяина, его значение
// и его писателя. Ради этого `latest` обновляется эффектом, а не в теле
// рендера: в теле он успел бы стать новым до того, как отработает cleanup,
// и черновик старого клиента уехал бы в нового.
export function useInlineNote<TKey>(
  value: string,
  /** Что именно правит поле (id записи журнала, объекта). Синхронизируется
   *  вместе со значением; писатель получает его вторым аргументом и может
   *  вернуть новый ключ — когда вместо правки родилась новая запись. */
  key: TKey,
  write: (next: string, boundKey: TKey) => TKey | void,
  ownerKey: string | null,
) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const touched = useRef(false);
  const written = useRef<string | null>(null);
  const bound = useRef<TKey>(key);
  const lastValue = useRef(value);
  useEffect(() => {
    if (value === lastValue.current) {
      if (!focused.current) bound.current = key;
      return;
    }
    lastValue.current = value;
    if (!focused.current) {
      setDraft(value);
      touched.current = false;
      written.current = null;
      bound.current = key;
    }
  }, [value, key]);

  const commit = useCallback(() => {
    if (!touched.current) return;
    const next = draft.trim();
    if (next === value.trim() || next === written.current) return;
    written.current = next;
    const nextKey = write(next, bound.current);
    if (nextKey !== undefined) bound.current = nextKey;
  }, [draft, value, write]);
  const latest = useRef(commit);
  useEffect(() => {
    latest.current = commit;
  });

  useEffect(() => () => latest.current(), [ownerKey]);
  useEffect(() => {
    focused.current = false;
    touched.current = false;
    written.current = null;
    bound.current = key;
    setDraft(value);
    // Только на смене хозяина: значение и ключ при этом — уже нового.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerKey]);

  return {
    draft,
    setDraft: (text: string) => {
      touched.current = true;
      setDraft(text);
    },
    onFocus: () => {
      focused.current = true;
    },
    onBlur: () => {
      focused.current = false;
      commit();
    },
    /** Дописать сейчас — перед сохранением записи: тап по кнопке фокус у
     *  поля не отбирает, и `onBlur` без этого не пришёл бы. */
    commit,
    /** Явный отказ от несохранённого: черновик не пишем ни сейчас, ни на
     *  уходе экрана. */
    discard: () => {
      touched.current = false;
    },
    /** Есть набранное, которого нет в базе, — для гварда «есть несохранённое». */
    dirty: touched.current && draft.trim() !== value.trim(),
  };
}
