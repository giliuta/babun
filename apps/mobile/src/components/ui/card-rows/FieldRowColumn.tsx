import { Pressable, Text, TextInput, View } from "react-native";
import type { FieldRowView } from "./use-field-row";

/** ПОДПИСЬ СЛЕВА КОЛОНКОЙ (`column`): «Телефон | +357 97 469 998». */
// A render helper, not a component: `FieldRow` returns its tree directly, so
// the element tree stays exactly what it was before the split.
export function renderFieldRowColumn(v: FieldRowView, column: number) {
  const {
    label, value, placeholder, separated, nativeKeyboard, autoCapitalize,
    autoFocus, multiline, valueColor, tabular, big, trailing, addLabel,
    inputColor, readOnly, onLongPress, noCopy, t, editing, editingNow, text,
    selectOnFocus, setInput, startEditing, focusInput, onChangeText, commit,
  } = v;
  return (
    <View>
      {separated ? (
        <View style={{ height: 1, marginLeft: 16 + column, backgroundColor: t.separator }} />
      ) : null}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          // Плотно, как строка имени: 44 —
          // минимум Apple под палец.
          minHeight: 44,
          paddingLeft: 16,
          paddingRight: trailing ? 8 : 16,
          paddingVertical: 2,
        }}
      >
        <Text
          maxFontSizeMultiplier={1.2}
          numberOfLines={1}
          style={{ width: column, fontSize: 15, color: t.caption, paddingRight: 8 }}
        >
          {label}
        </Text>
        <Pressable
          onPress={
            readOnly
              ? undefined
              : editingNow
                ? focusInput
                : startEditing
          }
          onLongPress={editingNow ? undefined : onLongPress}
          disabled={!!readOnly && !onLongPress}
          accessible={!editingNow}
          accessibilityRole={editingNow ? "none" : readOnly ? "text" : "button"}
          accessibilityLabel={value ? `${label}, ${value}` : label}
          accessibilityHint={editingNow || readOnly ? undefined : "Нажмите, чтобы изменить"}
          style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.6 : 1 })}
        >
          {editingNow ? (
            <TextInput
              ref={setInput}
              autoFocus={autoFocus || editing}
              value={text}
              onChangeText={onChangeText}
              onBlur={commit}
              onSubmitEditing={commit}
              blurOnSubmit={!multiline}
              placeholder={addLabel ?? placeholder}
              placeholderTextColor={addLabel ? t.accent : t.placeholder}
              selectionColor={t.accent}
              keyboardAppearance="light"
              keyboardType={nativeKeyboard}
              selectTextOnFocus={selectOnFocus}
              contextMenuHidden={noCopy}
              autoCapitalize={autoCapitalize}
              autoCorrect={false}
              spellCheck={false}
              accessibilityLabel={label}
              maxFontSizeMultiplier={1.2}
              style={{
                padding: 0,
                fontSize: 17,
                // `big` в колонке — имя: жирнее соседних значений.
                fontWeight: big ? "600" : "400",
                color: inputColor ?? t.ink,
                fontVariant: tabular ? ["tabular-nums"] : undefined,
              }}
            />
          ) : (
            <Text
              maxFontSizeMultiplier={1.2}
              numberOfLines={1}
              style={{
                fontSize: 17,
                fontWeight: big ? "600" : "400",
                color: value ? (valueColor ?? t.ink) : addLabel ? t.accent : t.placeholder,
                fontVariant: tabular ? ["tabular-nums"] : undefined,
              }}
            >
              {value || addLabel || placeholder}
            </Text>
          )}
        </Pressable>
        {trailing}
      </View>
    </View>
  );
}
