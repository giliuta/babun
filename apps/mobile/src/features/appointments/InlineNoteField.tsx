import { useRef } from "react";
import { Pressable, TextInput } from "react-native";
import type { useInlineNote } from "@/features/appointments/use-inline-note";
import { useThemeColors } from "@/theme/colors";

// МИНИ-БЛОК ЗАМЕТКИ ВНУТРИ КАРТОЧКИ (владелец 2026-09-04: «маленькая
// строчка, мини-блочок внутри блока — чтобы не бросался в глаза, но красиво
// смотрелся и не занимал много места»).
//
// Подложка `t.fill` со скруглением карточки — тот же материал, что у
// композера заметок на карточке клиента; в покое одна строка Subhead 13/18,
// пока печатают — до четырёх. Ни ярлыка, ни значка: чья заметка, говорит
// подсказка в поле, а карточка — о ком она.
//
// ОДИН РАЗМЕР НА ПРОДУКТ (владелец 2026-09-10, вторым заходом: «уменьши
// заметки, сделай такие заметки, как в клиентах… короче, сделай то же самое,
// как в клиентах»). Простор события давали пропом `tall` — четыре строки в
// покое вместо одной; владелец его снял. Прежняя причина «в событиях заметка
// и есть содержание встречи» проиграла правилу «блок выглядит одинаково
// везде»: возвращать проп — значит снова развести заметки по диалектам.
//
// 11.10 ВЛАДЕЛЕЦ РАЗВЁЛ ИХ САМ, И ПО ДРУГОЙ ЛИНИИ: «заметку — не маленькой
// строчкой, а побольше, 2–3 строчки сразу, чтоб удобно было тапать, в
// масштабе как стандартный блок». Это про СВОЙ блок «Заметка» записи и
// события — он стоит в ряду блоков (Объект, Файлы) и обязан быть с них
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
  /** Без меню «Скопировать» (владелец 30.09: сотрудник видит клиента, но
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
        paddingVertical: 7,
        borderRadius: t.radius.input,
        backgroundColor: t.fill,
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
          minHeight: rows * 18,
          maxHeight: Math.max(72, (rows + 5) * 18),
          textAlignVertical: "top",
          paddingTop: 0,
          paddingBottom: 0,
          fontSize: 13,
          lineHeight: 18,
          color: t.ink,
        }}
      />
    </Pressable>
  );
}
