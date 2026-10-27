import { useEffect, useRef, useState } from "react";
import type { TextInput } from "react-native";
import { LATIN_KEYBOARD } from "@/lib/keyboard";
import { useThemeColors } from "@/theme/colors";
import {
  cleanFieldInput,
  fieldAutoCapitalize,
  fieldKeyboardTraits,
  initialFieldText,
  typedWithoutSeed,
} from "./field-row-input";
import type { FieldRowProps } from "./field-row-props";

/** Editing state of one `FieldRow`: the open field, the typed text and the
 *  single commit point. The three layouts only draw what this returns. */
export function useFieldRow({
  value,
  keyboardType,
  autoCapitalize,
  autoFocus,
  live,
  big,
  onEditEnd,
  onType,
  inputRef,
  readOnly,
  followValue,
  sanitize,
  seed,
  onSave,
}: FieldRowProps) {
  const { selectOnFocus } = fieldKeyboardTraits(keyboardType);

  const t = useThemeColors();
  // autoFocus означает «начинай с ввода»: без этого строка рисовалась
  // текстом-заглушкой, TextInput не монтировался вовсе, и по «+ Добавить
  // номер» приходилось тапать по полю ВТОРОЙ раз, чтобы появилась
  // клавиатура.
  const [editing, setEditing] = useState(!!autoFocus);
  // Своя ссылка на поле — чтобы тап по строке мог поставить в него курсор;
  // пришедшая пропом (`inputRef`) получает то же поле.
  const ownInput = useRef<TextInput | null>(null);
  const setInput = (node: TextInput | null) => {
    ownInput.current = node;
    if (typeof inputRef === "function") inputRef(node);
    else if (inputRef) (inputRef as { current: TextInput | null }).current = node;
  };
  const [text, setText] = useState(() => initialFieldText(value, autoFocus, seed));
  const typedOf = (v: string) => typedWithoutSeed(v, seed);
  const startEditing = () => {
    if (!text.trim() && seed) setText(seed);
    setEditing(true);
  };
  useEffect(() => {
    if (!editing || followValue) setText(value);
  }, [value, editing, followValue]);

  const editingNow = !readOnly && (editing || !!live);
  const valueSize = big ? 17 : 15;
  const valueWeight = "600" as const;
  const clean = (v: string) => cleanFieldInput(v, keyboardType, sanitize);

  // Коммит значения. Единственная точка: blur, Return и размонтирование
  // строки. Раньше коммит был только в onBlur, а кнопки «Готово» и «Назад»
  // живут вне прокрутки и фокус не снимают — уход с экрана с открытой
  // клавиатурой стирал всё набранное.
  const latest = useRef({ text, value, live: !!live, onSave, onEditEnd, typedOf });
  latest.current = { text, value, live: !!live, onSave, onEditEnd, typedOf };
  const commit = () => {
    setEditing(false);
    const cur = latest.current;
    if (!cur.live && cur.typedOf(cur.text) !== cur.value) cur.onSave(cur.typedOf(cur.text));
    cur.onEditEnd?.();
  };
  useEffect(
    () => () => {
      const cur = latest.current;
      if (!cur.live && cur.typedOf(cur.text) !== cur.value) {
        cur.onSave(cur.typedOf(cur.text));
      }
    },
    [],
  );

  const onChangeText = (raw: string) => {
    const v = clean(raw);
    setText(v);
    onType?.(v);
    if (live) onSave(v);
  };
  const focusInput = () => ownInput.current?.focus();

  return {
    t,
    editing,
    editingNow,
    text,
    selectOnFocus,
    // `latin` — имя смысла, а не платформы: на iOS и Android латиницу
    // включают разные значения.
    nativeKeyboard: keyboardType === "latin" ? LATIN_KEYBOARD : keyboardType,
    autoCapitalize: fieldAutoCapitalize(keyboardType, autoCapitalize),
    valueSize,
    valueWeight,
    setInput,
    startEditing,
    focusInput,
    onChangeText,
    commit,
  };
}

/** Everything a layout of `FieldRow` draws from: the props and the state. */
export type FieldRowView = FieldRowProps & ReturnType<typeof useFieldRow>;
