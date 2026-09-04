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

export function InlineNoteField({
  note,
  placeholder,
  accessibilityLabel,
}: {
  note: ReturnType<typeof useInlineNote>;
  placeholder: string;
  accessibilityLabel: string;
}) {
  const t = useThemeColors();
  return (
    <View
      style={{
        marginHorizontal: 12,
        marginTop: 2,
        marginBottom: 10,
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
        maxFontSizeMultiplier={1.3}
        style={{
          minHeight: 18,
          maxHeight: 72,
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
