import { Pressable, Text, TextInput, View } from "react-native";
import type { FieldRowView } from "./use-field-row";

/** Прежний вид строки: ярлык слева, значение справа. */
// A render helper, not a component: `FieldRow` returns its tree directly, so
// the element tree stays exactly what it was before the split.
export function renderFieldRowInline(v: FieldRowView) {
  const {
    label, value, placeholder, separated, keyboardType, autoCapitalize,
    autoFocus, multiline, valueColor, tabular, trailing, onLabelPress,
    inputColor, readOnly, noCopy, t, editing, editingNow, text, selectOnFocus,
    setInput, startEditing, onChangeText, commit,
  } = v;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        minHeight: 48,
        paddingHorizontal: 16,
        paddingVertical: 8,
        gap: 12,
        borderTopWidth: separated ? 1 : 0,
        borderTopColor: t.separator,
      }}
    >
      {onLabelPress ? (
        <Pressable
          onPress={onLabelPress}
          accessibilityRole="button"
          accessibilityLabel={`Подпись номера: ${label}`}
          accessibilityHint="Нажмите, чтобы изменить подпись"
          hitSlop={8}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Text
            maxFontSizeMultiplier={1.2}
            numberOfLines={1}
            style={{ fontSize: 15, fontWeight: "600", color: t.ink }}
          >
            {label}
          </Text>
        </Pressable>
      ) : (
        <Text
          maxFontSizeMultiplier={1.2}
          numberOfLines={1}
          style={{ fontSize: 15, fontWeight: "600", color: t.ink }}
        >
          {label}
        </Text>
      )}

      <View style={{ flex: 1, alignItems: "flex-end" }}>
        {editingNow ? (
          <TextInput
            ref={setInput}
            autoFocus={autoFocus || editing}
            value={text}
            onChangeText={onChangeText}
            onBlur={commit}
            onSubmitEditing={commit}
            blurOnSubmit={!multiline}
            placeholder={placeholder}
            placeholderTextColor={t.placeholder}
            selectionColor={t.accent}
            keyboardAppearance="light"
            keyboardType={keyboardType}
            selectTextOnFocus={selectOnFocus}
            contextMenuHidden={noCopy}
            autoCapitalize={autoCapitalize}
            // Строка карточки — это ДАННЫЕ (имя, телефон, адрес, ник), а не
            // проза. iOS-автозамена молча переписывала введённое: «Zztest»
            // превращался в «Z test», и клиент сохранялся под чужим именем.
            // Многострочные поля (комментарий, заметка) — проза, там
            // подсказки уместны.
            autoCorrect={multiline ? undefined : false}
            spellCheck={multiline ? undefined : false}
            multiline={multiline}
            accessibilityLabel={label}
            maxFontSizeMultiplier={1.2}
            style={{
              alignSelf: "stretch",
              textAlign: "right",
              fontSize: 15,
              fontWeight: "500",
              color: inputColor ?? t.ink,
              paddingVertical: 4,
              fontVariant: tabular ? ["tabular-nums"] : undefined,
            }}
          />
        ) : (
          <Pressable
            onPress={readOnly ? undefined : startEditing}
            disabled={!!readOnly}
            accessibilityRole="button"
            accessibilityLabel={value ? `${label}: ${value}` : label}
            accessibilityHint="Нажмите, чтобы изменить"
            hitSlop={{ top: 10, bottom: 10, left: 10 }}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <Text
              maxFontSizeMultiplier={1.2}
              numberOfLines={multiline ? 3 : 1}
              style={{
                textAlign: "right",
                fontSize: 15,
                fontWeight: "500",
                color: value ? (valueColor ?? t.ink) : t.faint,
                fontVariant: tabular ? ["tabular-nums"] : undefined,
              }}
            >
              {value || placeholder}
            </Text>
          </Pressable>
        )}
      </View>

      {trailing}
    </View>
  );
}
