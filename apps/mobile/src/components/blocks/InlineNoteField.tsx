import { useRef } from "react";
import { Pressable, TextInput } from "react-native";
import type { useInlineNote } from "@/components/blocks/use-inline-note";
import { useThemeColors } from "@/theme/colors";

// ЗАМЕТКА — ЧИСТЫЙ ЛИСТ ДЛЯ ПИСЬМА. Серая плашка 13pt читалась мелким
// примечанием, а цветная бумага кричала громче самой записи. Поэтому —
// белое поле в тонкой светлой рамке, как лист, в который пишут: чёрный текст
// основным кеглем 15/20, без цвета и без тени. Ни ярлыка, ни значка: чья
// заметка, говорит подсказка в поле, а карточка — о ком она.
//
// Одна и та же у записи, события, клиента и объекта.
//
// ОДИН РАЗМЕР НА ПРОДУКТ: заметки в событиях такие же, как в клиентах. Проп
// `tall` (четыре строки в покое вместо одной) снят: довод «в событиях заметка и
// есть содержание встречи» проигрывает правилу «блок выглядит одинаково
// везде», и возвращать проп — значит снова развести заметки по диалектам.
//
// ИСКЛЮЧЕНИЕ ПО ДРУГОЙ ЛИНИИ — СВОЙ БЛОК «Заметка» записи и события: не
// маленькая строчка, а 2–3 строчки сразу, чтобы удобно было тапать, в масштабе
// стандартного блока. Он стоит в ряду блоков (Объект, Файлы) и обязан быть с них
// ростом. Мини-заметки ВНУТРИ карточек клиента и объекта остаются строкой:
// они подпись к блоку, а не блок. Поэтому `rows` — по месту, а не по
// сущности: три строки в покое, тап по всей плашке ставит курсор.

export function InlineNoteField({
  note,
  placeholder,
  accessibilityLabel,
  maxLength,
  readOnly = false,
  noCopy = false,
  rows = 1,
}: {
  note: Pick<
    ReturnType<typeof useInlineNote<unknown>>,
    "draft" | "setDraft" | "onFocus" | "onBlur"
  >;
  placeholder: string;
  accessibilityLabel: string;
  /** Тот же предел, что у композера на карточке (500 у заметки клиента). */
  maxLength?: number;
  /** Права писать нет (STORY-084, одна страница записи для всех): та же
   *  плашка, но без клавиатуры. Пустую заметку тогда не рисуем вовсе —
   *  поле с подсказкой звало бы печатать там, где печатать нельзя. */
  readOnly?: boolean;
  /** Без меню «Скопировать» (сотрудник видит клиента, но
   *  вынести его не может). */
  noCopy?: boolean;
  /** Строк в покое: 1 — мини-заметка внутри карточки, 3 — свой блок
   *  «Заметка» записи и события. */
  rows?: number;
}) {
  const t = useThemeColors();
  const input = useRef<TextInput>(null);
  if (readOnly && !note.draft.trim()) return null;
  return (
    <Pressable
      // Вся плашка — поле: тап мимо строки текста тоже ставит курсор.
      onPress={readOnly ? undefined : () => input.current?.focus()}
      accessible={false}
      style={{
        marginHorizontal: 12,
        marginTop: 2,
        marginBottom: 8,
        paddingHorizontal: 12,
        paddingVertical: 9,
        borderRadius: t.radius.input,
        borderWidth: 1,
        borderColor: t.separator,
        backgroundColor: t.surface,
      }}
    >
      <TextInput
        ref={input}
        keyboardAppearance="light"
        accessibilityLabel={accessibilityLabel}
        value={note.draft}
        editable={!readOnly}
        onChangeText={note.setDraft}
        onFocus={note.onFocus}
        onBlur={note.onBlur}
        placeholder={placeholder}
        placeholderTextColor={t.placeholder}
        selectionColor={t.accent}
        multiline
        maxLength={maxLength}
        contextMenuHidden={noCopy}
        maxFontSizeMultiplier={1.3}
        style={{
          minHeight: rows * 20,
          maxHeight: Math.max(80, (rows + 5) * 20),
          textAlignVertical: "top",
          paddingTop: 0,
          paddingBottom: 0,
          fontSize: 15,
          lineHeight: 20,
          color: t.ink,
        }}
      />
    </Pressable>
  );
}
