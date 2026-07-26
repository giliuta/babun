import { useEffect, useState, type ReactNode } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { useThemeColors } from "@/theme/colors";

// ЕДИНАЯ СТРОКА КАРТОЧКИ КЛИЕНТА — тот же диалект, что у строк фильтров:
// «ярлык слева … значение справа», 48pt, тап = правка на месте. Владелец
// 2026-07-26: «разделить чётко — имя, номер телефона, объекты и так
// далее, всё зафиксировано в своём блоке и всегда можно редактировать».
//
// Почему строки, а не «постер»: раньше имя было крупным заголовком, а
// телефон — мелкой строкой под ним, и на экране создания это читалось
// перевёрнуто (заголовок «Имя», а курсор в номере). Строка с ярлыком
// снимает вопрос «что это за поле» в обоих режимах сразу.

export function RowGroup({
  title,
  children,
}: {
  /** Капс-надпись над группой; без неё группа безымянная. */
  title?: string;
  children: ReactNode;
}) {
  const t = useThemeColors();
  return (
    <View style={{ marginHorizontal: 12, marginTop: 12 }}>
      {title ? (
        <Text
          maxFontSizeMultiplier={1.3}
          style={{
            marginBottom: 6,
            marginLeft: 4,
            fontSize: 11,
            fontWeight: "700",
            letterSpacing: 1.4,
            textTransform: "uppercase",
            color: t.faint,
          }}
        >
          {title}
        </Text>
      ) : null}
      <View
        style={{
          borderRadius: t.radius.card,
          overflow: "hidden",
          backgroundColor: t.surface,
        }}
      >
        {children}
      </View>
    </View>
  );
}

/** Строка-факт: ярлык · значение · опциональный хвост. Тап по значению
 *  открывает правку на месте (сохранение по blur, как в остальной
 *  карточке). `live` — режим черновика: пишем на каждый символ, потому что
 *  «Готово» читает черновик из текущего замыкания и blur не успел бы. */
export function FieldRow({
  label,
  value,
  placeholder,
  separated,
  keyboardType,
  autoFocus,
  live,
  multiline,
  valueColor,
  tabular,
  trailing,
  onLabelPress,
  onSave,
}: {
  label: string;
  value: string;
  placeholder: string;
  separated?: boolean;
  keyboardType?: "phone-pad" | "email-address" | "default";
  autoFocus?: boolean;
  live?: boolean;
  multiline?: boolean;
  valueColor?: string;
  tabular?: boolean;
  trailing?: ReactNode;
  /** Ярлык тоже редактируем (доп. номера: «Жена», «Рабочий»). */
  onLabelPress?: () => void;
  onSave: (v: string) => void;
}) {
  const t = useThemeColors();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  useEffect(() => {
    if (!editing) setText(value);
  }, [value, editing]);

  const editingNow = editing || !!live;

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
            style={{ fontSize: 15, fontWeight: "600", color: t.sub }}
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
            autoFocus={autoFocus ?? editing}
            value={text}
            onChangeText={(v) => {
              setText(v);
              if (live) onSave(v);
            }}
            onBlur={() => {
              setEditing(false);
              if (!live && text.trim() !== value) onSave(text.trim());
            }}
            placeholder={placeholder}
            placeholderTextColor={t.placeholder}
            selectionColor={t.accent}
            keyboardAppearance="light"
            keyboardType={keyboardType}
            multiline={multiline}
            accessibilityLabel={label}
            maxFontSizeMultiplier={1.2}
            style={{
              alignSelf: "stretch",
              textAlign: "right",
              fontSize: 15,
              fontWeight: "500",
              color: t.ink,
              paddingVertical: 4,
              fontVariant: tabular ? ["tabular-nums"] : undefined,
            }}
          />
        ) : (
          <Pressable
            onPress={() => setEditing(true)}
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

/** Строка-дверь: ярлык · значение · шеврон. Шеврон — единственный признак,
 *  отличающий «уводит» от «правится на месте», когда обе строки выглядят
 *  одинаково. `loud` — единственная громкая поверхность экрана («Записать»). */
export function NavRow({
  label,
  value,
  placeholder,
  valueColor,
  separated,
  loud,
  dimmed,
  onPress,
}: {
  label: string;
  value?: string | null;
  placeholder?: string;
  valueColor?: string;
  separated?: boolean;
  loud?: boolean;
  dimmed?: boolean;
  onPress: () => void;
}) {
  const t = useThemeColors();
  const shown = value || placeholder || "";
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={shown ? `${label}: ${shown}` : label}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        minHeight: loud ? 52 : 48,
        paddingHorizontal: 16,
        gap: 12,
        opacity: dimmed ? 0.5 : 1,
        borderTopWidth: separated ? 1 : 0,
        borderTopColor: t.separator,
        backgroundColor: loud
          ? t.accent
          : pressed
            ? t.pressed
            : "transparent",
      })}
    >
      <Text
        maxFontSizeMultiplier={1.2}
        numberOfLines={1}
        style={{
          fontSize: loud ? 17 : 15,
          fontWeight: "600",
          color: loud ? t.onAccent : t.ink,
        }}
      >
        {label}
      </Text>
      <View style={{ flex: 1, alignItems: "flex-end" }}>
        {shown ? (
          <Text
            maxFontSizeMultiplier={1.2}
            numberOfLines={1}
            style={{
              fontSize: 15,
              fontWeight: "500",
              color: loud
                ? t.onAccent
                : value
                  ? (valueColor ?? t.ink)
                  : t.faint,
            }}
          >
            {shown}
          </Text>
        ) : null}
      </View>
      <ChevronRight
        color={loud ? t.onAccent : t.chevron}
        size={17}
        strokeWidth={2.2}
      />
    </Pressable>
  );
}

/** Ряд-действие внутри группы («+ Добавить номер»). */
export function AddRow({
  label,
  separated,
  onPress,
}: {
  label: string;
  separated?: boolean;
  onPress: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        minHeight: 48,
        paddingHorizontal: 16,
        borderTopWidth: separated ? 1 : 0,
        borderTopColor: t.separator,
        backgroundColor: pressed ? t.pressed : "transparent",
      })}
    >
      <Text
        maxFontSizeMultiplier={1.2}
        style={{ fontSize: 15, fontWeight: "600", color: t.accent }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
