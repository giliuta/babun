import { useCallback, useEffect, useRef, useState } from "react";

// ЗАМЕТКА ПРЯМО В ФОРМЕ, А НЕ ЗА ТАПОМ (владелец 2026-09-04: «просто
// мини-блок, куда можно вписывать сразу — как в самом низу»). Заметка клиента
// и заметка объекта живут не в записи, а в клиенте и в объекте, поэтому поле
// пишет туда само: когда уходят с поля, когда у поля меняется хозяин (выбрали
// другого клиента или объект) и когда экран уходит — набранное не теряем
// молча. Пока печатают, свежее значение с сервера черновик не перетирает.
//
// СМЕНА ХОЗЯИНА ДОПИСЫВАЕТ СТАРОМУ. Cleanup эффекта по `ownerKey` зовёт
// `commit` ПРОШЛОГО рендера — тот, что замкнул старого хозяина, его значение и
// его писателя. Ради этого `latest` обновляется эффектом, а не в теле рендера:
// в теле он успел бы стать новым до того, как отработает cleanup, и черновик
// старого клиента уехал бы в нового.
export function useInlineNote(
  value: string,
  write: (next: string) => void,
  ownerKey: string | null,
) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const lastValue = useRef(value);
  useEffect(() => {
    if (value === lastValue.current) return;
    lastValue.current = value;
    if (!focused.current) setDraft(value);
  }, [value]);

  const commit = useCallback(() => {
    const next = draft.trim();
    if (next !== value.trim()) write(next);
  }, [draft, value, write]);
  const latest = useRef(commit);
  useEffect(() => {
    latest.current = commit;
  });

  useEffect(() => () => latest.current(), [ownerKey]);
  useEffect(() => {
    focused.current = false;
    setDraft(value);
    // Только на смене хозяина: значение при этом — уже нового.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerKey]);

  return {
    draft,
    setDraft,
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
  };
}
