// Pure input rules of `FieldRow`: what the keyboard selects on focus, what
// the empty field starts with, what counts as typed, and what may enter it.

import { sanitizePhoneInput } from "@/lib/phone-input";
import type { FieldKeyboardType } from "./field-row-props";

export function fieldKeyboardTraits(keyboardType: FieldKeyboardType | undefined): {
  numericKeyboard: boolean;
  selectOnFocus: boolean;
} {
  // ЧИСЛО ВЫДЕЛЯЕТСЯ ЦЕЛИКОМ ПРИ ФОКУСЕ — иначе правка «135» на «140» даёт
  // «140135» (проверено в симуляторе 2026-08-22 на цене услуги). У цифровой
  // клавиатуры нет ни стрелок, ни удобного способа встать в конец: курсор
  // падает туда, куда попал палец, и набранное приписывается к старому.
  // Текстовым полям выделение НЕ нужно: там дописывают, а не заменяют.
  const numericKeyboard =
    keyboardType === "decimal-pad" ||
    keyboardType === "numbers-and-punctuation" ||
    keyboardType === "phone-pad";
  // НОМЕР — ИСКЛЮЧЕНИЕ. Строка номера открывается с уже подставленным кодом
  // страны («+357»), и выделение целиком стирало его первой же цифрой: в
  // базу уезжало «99 123456» без кода, а звонок, SMS и WhatsApp собирались
  // из такого номера по-разному. Код — начало ввода, его продолжают.
  const selectOnFocus = numericKeyboard && keyboardType !== "phone-pad";
  return { numericKeyboard, selectOnFocus };
}

/** Text the field starts with: an empty autofocused field opens on `seed`. */
export function initialFieldText(
  value: string,
  autoFocus: boolean | undefined,
  seed: string | undefined,
): string {
  return !value && autoFocus && seed ? seed : value;
}

/** Набранное без одного кода страны: только код — пусто. */
export function typedWithoutSeed(v: string, seed: string | undefined): string {
  const typed = v.trim();
  return seed && typed === seed.trim() ? "" : typed;
}

// Буквы в номер не попадают НИ ОДНИМ путём — ни вставкой, ни диктовкой,
// ни внешней клавиатурой. Чистка живёт в примитиве, а не в каждом вызове:
// забыть её на новой строке-номере невозможно.
export function cleanFieldInput(
  v: string,
  keyboardType: FieldKeyboardType | undefined,
  sanitize: ((v: string) => string) | undefined,
): string {
  return keyboardType === "phone-pad" ? sanitizePhoneInput(v) : sanitize ? sanitize(v) : v;
}
