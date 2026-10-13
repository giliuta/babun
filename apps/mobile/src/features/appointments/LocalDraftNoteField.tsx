import { useEffect, useRef, useState, type ComponentProps } from "react";
import { InlineNoteField } from "@/features/appointments/InlineNoteField";

// ЗАМЕТКА С ЧЕРНОВИКОМ ВНУТРИ ПОЛЯ (аудит Android 13.10). Заметка записи жила
// состоянием всей формы записи: каждая буква перерисовывала экран в четыре
// тысячи строк — десятки состояний, памяток и смонтированных шторок, — и на
// Android ввод отставал от пальца. Теперь буква перерисовывает только поле;
// форма узнаёт текст сразу через `onType` (ссылка, без перерисовки — по ней
// сохраняют) и состоянием — после паузы в наборе или ухода с поля.

const SETTLE_MS = 350;

type FieldProps = Omit<ComponentProps<typeof InlineNoteField>, "note">;

export function LocalDraftNoteField({
  value,
  onType,
  onSettled,
  onFocus,
  ...field
}: FieldProps & {
  /** Текст из формы: правка открытой записи, сброс. */
  value: string;
  /** Каждая буква — без перерисовки формы (в ссылку). */
  onType: (text: string) => void;
  /** Набор затих или поле ушло из фокуса — теперь в состояние формы. */
  onSettled: (text: string) => void;
  onFocus: () => void;
}) {
  const [draft, setDraft] = useState(value);
  // Последнее, что поле само отдало форме: пришедшее обратно то же значение
  // — не повод перезаписывать набираемое.
  const settled = useRef(value);
  useEffect(() => {
    if (value === settled.current) return;
    settled.current = value;
    setDraft(value);
  }, [value]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const settle = (text: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    settled.current = text;
    onSettled(text);
  };

  return (
    <InlineNoteField
      {...field}
      note={{
        draft,
        setDraft: (text: string) => {
          setDraft(text);
          onType(text);
          // ПЕРВАЯ БУКВА ПОСЛЕ ПАУЗЫ — В ФОРМУ СРАЗУ: «Введённое не
          // сохранится» и подпись правки должны узнать о наборе мгновенно,
          // иначе «Отмена» сразу после буквы ушла бы молча. Дальше в серии —
          // одним разом после паузы.
          const burst = timer.current !== null;
          if (timer.current) clearTimeout(timer.current);
          if (!burst) settle(text);
          timer.current = setTimeout(() => settle(text), SETTLE_MS);
        },
        onFocus,
        onBlur: () => settle(draft),
      }}
    />
  );
}
