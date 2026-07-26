import { ActionSheetIOS, Alert, Platform } from "react-native";
import { haptics } from "@/lib/haptics";

// ВЫБОР «ЧТО СДЕЛАТЬ» / «КАКОЕ ЗНАЧЕНИЕ» — ОДНА ТОЧКА НА ВЕСЬ ПРОДУКТ.
//
// Владелец отверг кастомный лист снизу для такого выбора, поэтому на iOS это
// нативный ActionSheetIOS. Но ActionSheetIOS существует ТОЛЬКО на iOS: при
// сборке того же кода в веб-цель Expo (react-native-web) его нет вовсе, и
// каждый прямой вызов стал бы отдельной правкой при портировании.
//
// Поэтому экраны зовут chooseOption(), а платформа живёт здесь. Веб-версия —
// это одна реализация в этом файле, а не тринадцать правок по экранам
// (решение 2026-07-26: приложение первично, веб собирается из него же).
//
// Возвращает индекс выбранного пункта или null («Отмена» / закрытие).

export interface Choice {
  label: string;
  /** Красный пункт: удаление, снятие, отмена записи. */
  destructive?: boolean;
}

export function chooseOption(
  title: string,
  choices: Choice[],
  opts?: { message?: string; haptic?: boolean },
): Promise<number | null> {
  const usable = choices.filter((c) => c.label.trim().length > 0);
  if (usable.length === 0) return Promise.resolve(null);
  if (opts?.haptic !== false) haptics.tap();

  if (Platform.OS === "ios") {
    const options = [...usable.map((c) => c.label), "Отмена"];
    const destructiveButtonIndex = usable.findIndex((c) => c.destructive);
    return new Promise((resolve) => {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title,
          message: opts?.message,
          options,
          cancelButtonIndex: options.length - 1,
          ...(destructiveButtonIndex >= 0 ? { destructiveButtonIndex } : {}),
        },
        (index) => resolve(index < usable.length ? index : null),
      );
    });
  }

  // Не-iOS: временный мост на системный алерт. Он вмещает мало кнопок, поэтому
  // при переносе в веб здесь появится канонический список — но экраны об этом
  // уже не узнают, они зовут ту же функцию.
  return new Promise((resolve) => {
    Alert.alert(title, opts?.message, [
      ...usable.map((c, i) => ({
        text: c.label,
        style: c.destructive ? ("destructive" as const) : ("default" as const),
        onPress: () => resolve(i),
      })),
      { text: "Отмена", style: "cancel", onPress: () => resolve(null) },
    ]);
  });
}

/** Частый случай: выбор ОДНОГО значения из списка подписей. */
export async function chooseValue<T>(
  title: string,
  items: readonly { value: T; label: string }[],
  opts?: { clearLabel?: string },
): Promise<{ value: T | null } | null> {
  const choices: Choice[] = items.map((i) => ({ label: i.label }));
  if (opts?.clearLabel) choices.push({ label: opts.clearLabel });
  const index = await chooseOption(title, choices);
  if (index === null) return null;
  if (index < items.length) return { value: items[index].value };
  return { value: null };
}
