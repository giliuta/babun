import { useRef, useState } from "react";
import { SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { confirmAction } from "@/lib/confirm";

// ЗАКРЫТЬ ЛИСТ С НАБРАННЫМ — ТОЛЬКО ПОСЛЕ ВОПРОСА.
//
// Скрим, свайп вниз и «Отмена» закрывали формы в листах молча, и черновик
// пропадал (аудит 2026-10-03: шаблон SMS, услуга). Приём тот же, что у
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
}: {
  dirty: boolean;
  /** Идёт запись — закрывать нельзя вовсе. */
  busy?: boolean;
  onClose: () => void;
  /** Вторая строка вопроса: что именно не сохранится. */
  message: string;
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
    void confirmAction("Закрыть без сохранения?", {
      message,
      confirmLabel: "Закрыть",
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
