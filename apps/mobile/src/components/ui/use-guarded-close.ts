import { useRef, useState } from "react";
import { SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { confirmAction } from "@/lib/confirm";

// ЗАКРЫТЬ ЛИСТ С НАБРАННЫМ — ТОЛЬКО ПОСЛЕ ВОПРОСА.
//
// Скрим, свайп вниз и «Отмена» закрывали формы в листах молча, и черновик
// пропадал (шаблон SMS, услуга). Приём тот же, что у
// операции и долга: лист уезжает, вопрос — после (два окна iOS разом не
// показывает), «нет» возвращает лист с набранным — черновик живёт в
// компоненте листа и при этом не сбрасывается.
//
// Подключение: `visible={visible && !guard.hidden}`, `onClose={guard.close}`,
// `onExited={guard.onExited}`.
export function useGuardedClose({
  dirty,
  busy = false,
  onClose,
  message,
  title = "Закрыть без сохранения?",
  confirmLabel = "Не сохранять",
}: {
  dirty: boolean;
  /** Идёт запись — закрывать нельзя вовсе. */
  busy?: boolean;
  onClose: () => void;
  /** Вторая строка вопроса: что именно не сохранится. */
  message: string;
  /** Сам вопрос — у листа с «Применить» он про применение, а не сохранение. */
  title?: string;
  /** Кнопка ухода. «Не сохранять» — те же слова, что у формы записи и
   *  карточки клиента; свой вопрос (про применение) несёт свою кнопку. */
  confirmLabel?: string;
}) {
  const [hidden, setHidden] = useState(false);
  const askOnExit = useRef(false);
  const close = () => {
    if (busy) return;
    if (!dirty) {
      onClose();
      return;
    }
    askOnExit.current = true;
    setHidden(true);
  };
  const onExited = () => {
    if (!askOnExit.current) return;
    askOnExit.current = false;
    void confirmAction(title, {
      message,
      confirmLabel,
      destructive: true,
    }).then((ok) => {
      if (ok) {
        setHidden(false);
        onClose();
        return;
      }
      // Лист выбора ещё уезжает — второе окно подаём после него.
      setTimeout(() => setHidden(false), SHEET_EXIT_MS + 350);
    });
  };
  return { hidden, close, onExited };
}
