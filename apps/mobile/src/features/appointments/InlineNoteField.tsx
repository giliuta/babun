import { TextInput, View } from "react-native";
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
// ПРОСТОР — ПРОПОМ, А НЕ ВТОРЫМ ПОЛЕМ (`tall`, владелец 2026-09-10: «сделай
// заметку в событиях такую же, как заметка в клиентах», при живущем с
// 2026-09-08 «в событиях заметка считается более правильной — поставить туда
// как можно больше места»). У события заметка и есть содержание встречи,
// поэтому поле начинается с четырёх строк и растёт до двенадцати. Материал,
// кегль и отступы — те же: заводить ради простора второе поле значило бы
// снова развести заметки продукта по разным диалектам.

export function InlineNoteField({
  note,
  placeholder,
  accessibilityLabel,
  maxLength,
  tall,
}: {
  note: Pick<
    ReturnType<typeof useInlineNote<unknown>>,
    "draft" | "setDraft" | "onFocus" | "onBlur"
  >;
  placeholder: string;
  accessibilityLabel: string;
  /** Тот же предел, что у композера на карточке (500 у заметки клиента). */
  maxLength?: number;
  /** Поле-содержание (заметка события): начинается с четырёх строк и растёт
   *  до двенадцати, а не до четырёх. */
  tall?: boolean;
}) {
  const t = useThemeColors();
  return (
    <View
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
        keyboardAppearance="light"
        accessibilityLabel={accessibilityLabel}
        value={note.draft}
        onChangeText={note.setDraft}
        onFocus={note.onFocus}
        onBlur={note.onBlur}
        placeholder={placeholder}
        placeholderTextColor={t.placeholder}
        selectionColor={t.accent}
        multiline
        maxLength={maxLength}
        maxFontSizeMultiplier={1.3}
        style={{
          minHeight: tall ? 72 : 18,
          maxHeight: tall ? 216 : 72,
          textAlignVertical: "top",
          paddingTop: 0,
          paddingBottom: 0,
          fontSize: 13,
          lineHeight: 18,
          color: t.ink,
        }}
      />
    </View>
  );
}
