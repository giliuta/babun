import { ActionSheetIOS, Alert, Platform } from "react-native";
import {
  choiceSheetReady,
  presentChoiceSheet,
} from "@/components/ui/ChoiceSheet";
import { haptics } from "@/lib/haptics";

// ВЫБОР «ЧТО СДЕЛАТЬ» / «КАКОЕ ЗНАЧЕНИЕ» — ОДНА ТОЧКА НА ВЕСЬ ПРОДУКТ.
//
// Владелец 2026-07-27: «мне не нравится, когда оно посередине вылазит — пусть
// снизу выезжает, как и всё». Поэтому выбор рисует канонический нижний лист
// (ChoiceSheetHost в корне приложения), а нативный ActionSheetIOS остался
// только запасным путём — на случай, если хост почему-то не смонтирован.
// Экраны об этом не знают: они по-прежнему зовут chooseOption().
//
// Второй смысл этой точки — веб: ActionSheetIOS существует ТОЛЬКО на iOS, и
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

  if (choiceSheetReady()) {
    return presentChoiceSheet(title, usable, { message: opts?.message });
  }

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

  // Браузер без смонтированного хоста (вызов до появления дерева). Системный
  // алерт здесь — пустая функция, поэтому спрашиваем окном самого браузера:
  // один вопрос оно вмещает, и это ровно форма подтверждения. Список из
  // нескольких действий окном не задать — тогда честно показываем текст и
  // отвечаем «отмена», а не делаем вид, что спросили.
  if (Platform.OS === "web") {
    const head = [title, opts?.message].filter(Boolean).join("\n\n");
    if (usable.length === 1) {
      const ok = globalThis.confirm?.(`${head}\n\n${usable[0].label}`) ?? false;
      return Promise.resolve(ok ? 0 : null);
    }
    globalThis.alert?.(head);
    return Promise.resolve(null);
  }

  // Не-iOS натив: временный мост на системный алерт. Он вмещает мало кнопок,
  // но экраны об этом не узнают — они зовут ту же функцию.
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
