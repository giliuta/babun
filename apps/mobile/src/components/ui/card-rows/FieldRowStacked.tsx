import { Pressable, Text, TextInput, View } from "react-native";
import type { FieldRowView } from "./use-field-row";

/** Ярлык СВЕРХУ, значение под ним по левому краю (`stacked`). */
// A render helper, not a component: `FieldRow` returns its tree directly, so
// the element tree stays exactly what it was before the split.
export function renderFieldRowStacked(v: FieldRowView) {
  const {
    label, value, placeholder, separated, nativeKeyboard, autoCapitalize,
    autoFocus, multiline, valueColor, tabular, hideLabel, trailing,
    onLabelPress, addLabel, inputColor, readOnly, compact, onLongPress, noCopy,
    t, editing, editingNow, text, selectOnFocus, valueSize, valueWeight,
    setInput, startEditing, focusInput, onChangeText, commit,
  } = v;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        minHeight: compact ? 44 : 60,
        paddingHorizontal: 16,
        paddingVertical: compact ? 4 : 10,
        borderTopWidth: separated ? 1 : 0,
        borderTopColor: t.separator,
      }}
    >
      {/* Нажимается ВСЯ левая колонка, а не только текст значения: строка
          60pt, а правка открывалась лишь прицельным попаданием в буквы —
          капс-ярлык и пустота справа от короткого значения были мёртвыми,
          хотя правка поля — самое частое действие на странице. Хвост
          (кнопка связи, ✕) остаётся СНАРУЖИ: вложенный в нажимаемую
          область он склеивается со строкой для VoiceOver. */}
      <Pressable
        // В ЖИВОМ ВВОДЕ (`live`: новый клиент, лист реквизитов) поле уже
        // смонтировано. Выключенная строка ставила бы курсор только точным
        // попаданием в само значение, а тап по подписи над ним («VAT номер»)
        // не делал бы ничего — цифры уходили бы в прошлое поле. Поэтому тап
        // по любой части строки ставит курсор в её поле.
        onPress={
          readOnly
            ? undefined
            : editingNow
              ? focusInput
              : startEditing
        }
        onLongPress={editingNow ? undefined : onLongPress}
        disabled={!!readOnly && !onLongPress}
        // В РЕЖИМЕ ПРАВКИ контейнер перестаёт быть элементом доступности:
        // иначе он склеивает TextInput внутрь себя, и VoiceOver не может
        // войти в поле — клиента становится нельзя создать вслепую.
        accessible={!editingNow}
        accessibilityRole={editingNow ? "none" : readOnly ? "text" : "button"}
        // Запятая, а не двоеточие: VoiceOver даёт паузу, и строка читается
        // «Мобильный, +357 …», а не как «поле: значение».
        accessibilityLabel={value ? `${label}, ${value}` : label}
        accessibilityHint={editingNow || readOnly ? undefined : "Нажмите, чтобы изменить"}
        // Смена подписи вложена в строку и потому недоступна VoiceOver:
        // отдаём её действием ротора, не разбивая строку на две остановки.
        accessibilityActions={
          onLabelPress ? [{ name: "relabel", label: "Изменить подпись" }] : undefined
        }
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === "relabel") onLabelPress?.();
        }}
        style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.6 : 1 })}
      >
        {/* Ярлык бывает редактируемым (подпись доп. номера: «Мобильный»,
            «Рабочий») — тогда он нажимается и здесь, иначе перевод строки
            на левое выравнивание отобрал бы смену подписи.

            ВЫГЛЯДИТ ОН ПРИ ЭТОМ ОДИНАКОВО с обычным: второй номер соответствует
            первому, всё стандартное, одного размера. Синий ярлык делал строку
            доп. номера громче
            основного телефона, хотя это тот же номер того же клиента. */}
        {hideLabel ? null : (() => {
          // ПОДПИСЬ СТРОКИ — ПОЯСНЕНИЕ, А НЕ ЗАГОЛОВОК.
          //
          // Типографика заголовка ГРУППЫ (11/700 капс, полный ink) превратила бы
          // четыре номера подряд в четыре заголовка разделов: карточка человека
          // выглядела бы анкетой. Поэтому подпись КРУПНЕЕ (13), но тише: обычный
          // регистр, приглушённые чернила. Капс в продукте значит ровно одно —
          // «начало группы».
          //
          // Правило: полный ink остаётся
          // за ИМЕНЕМ ПОЛЯ (заголовки групп), а тип значения («Мобильный»,
          // «Рабочий») — пояснение, и приглушается размером и альфой, а не
          // серым пигментом (t.sub — те же чернила на 74%).
          const labelNode = (
            <Text
              maxFontSizeMultiplier={1.2}
              numberOfLines={1}
              style={{
                fontSize: compact ? 12 : 13,
                fontWeight: "500",
                color: t.sub,
                marginBottom: compact ? 0 : 2,
              }}
            >
              {label}
            </Text>
          );
          return onLabelPress ? (
            <Pressable
              onPress={onLabelPress}
              accessibilityRole="button"
              accessibilityLabel={`Подпись номера: ${label}`}
              accessibilityHint="Нажмите, чтобы изменить подпись"
              hitSlop={{ top: 8, bottom: 4, left: 8, right: 8 }}
              style={({ pressed }) => ({
                alignSelf: "flex-start",
                opacity: pressed ? 0.6 : 1,
              })}
            >
              {labelNode}
            </Pressable>
          ) : (
            labelNode
          );
        })()}
        {editingNow ? (
          <TextInput
            ref={setInput}
            autoFocus={autoFocus || editing}
            value={text}
            onChangeText={onChangeText}
            onBlur={commit}
            onSubmitEditing={commit}
            // «Готово»/«Назад» живут ВНЕ прокрутки и поле не разфокусируют:
            // без коммита на размонтировании набранное уезжало с экраном.
            blurOnSubmit={!multiline}
            // Пустое поле предлагает ДЕЙСТВИЕ («Добавить»), а не инструкцию:
            // в режиме создания поле открыто для ввода, и без этого строка
            // выглядела просто пустой.
            placeholder={addLabel ?? placeholder}
            placeholderTextColor={addLabel ? t.accent : t.placeholder}
            selectionColor={t.accent}
            keyboardAppearance="light"
            keyboardType={nativeKeyboard}
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
              padding: 0,
              fontSize: valueSize,
              fontWeight: valueWeight,
              color: inputColor ?? t.ink,
              fontVariant: tabular ? ["tabular-nums"] : undefined,
            }}
          />
        ) : (
          <Text
            maxFontSizeMultiplier={1.2}
            numberOfLines={multiline ? 3 : 1}
            style={{
              fontSize: valueSize,
              fontWeight: valueWeight,
              color: value
                ? (valueColor ?? t.ink)
                : addLabel
                  ? t.accent
                  : t.faint,
              fontVariant: tabular ? ["tabular-nums"] : undefined,
            }}
          >
            {value || addLabel || placeholder}
          </Text>
        )}
      </Pressable>
      {trailing}
    </View>
  );
}
