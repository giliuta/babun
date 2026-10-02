import { Ban, Bell, CalendarPlus, Check, Merge, Share2, Split, Trash2 } from "lucide-react-native";

import type { PickerSheetItem } from "@/components/ui/PickerSheet";
import type { ThemeColors } from "@/theme/colors";

// МЕНЮ КЛИЕНТА — ОДНО НА ДВА ВХОДА (владелец 03.10: «долгое нажатие или
// открытие трёх точек — это одно и то же»). Долгое нажатие в списке
// (`ClientActionsSheet`) и «⋯» на странице клиента (`ClientDetailChrome`)
// собирают пункты здесь, в одном порядке и одним видом.
//
// «Закрепить» и «В архив» убраны совсем (владелец 03.10: «закрепить у нас не
// будет», «понятия „в архив“ не будет — удалить»). «Поделиться» и «В чёрный
// список» добавлены в оба входа.
//
// Пункт стоит, только если вход передал его обработчик: нет права — нет и
// пункта, а не пункт, который кончится отказом. Своё у входа — тоже по
// обработчику: «Записать» и «Выбрать несколько» есть только у строки списка
// (у страницы своя кнопка «Записать» внизу), «Объединить» и «Разделить» —
// только у страницы, где видно, с кем сливать и что выносить.

export interface ClientMenuHandlers {
  onBook?: () => void;
  onRemind?: () => void;
  onShare?: () => void;
  onSelectMany?: () => void;
  onMerge?: () => void;
  onSplit?: () => void;
  onToggleBlacklist?: () => void;
  onDelete?: () => void;
}

export function clientMenuItems(
  t: Pick<ThemeColors, "accent" | "warning" | "danger">,
  blacklisted: boolean,
  handlers: ClientMenuHandlers,
): PickerSheetItem[] {
  const items: (PickerSheetItem | null)[] = [
    handlers.onBook
      ? { id: "book", label: "Записать", icon: CalendarPlus, color: t.accent, onPress: handlers.onBook }
      : null,
    handlers.onShare
      ? { id: "share", label: "Поделиться", icon: Share2, color: t.accent, onPress: handlers.onShare }
      : null,
    handlers.onSelectMany
      ? { id: "select", label: "Выбрать несколько", icon: Check, color: t.accent, onPress: handlers.onSelectMany }
      : null,
    handlers.onRemind
      ? { id: "remind", label: "Напомнить", icon: Bell, color: t.warning, onPress: handlers.onRemind }
      : null,
    handlers.onMerge
      ? { id: "merge", label: "Объединить с дублем", icon: Merge, color: t.accent, onPress: handlers.onMerge }
      : null,
    handlers.onSplit
      ? { id: "split", label: "Разделить клиента", icon: Split, color: t.accent, onPress: handlers.onSplit }
      : null,
    handlers.onToggleBlacklist
      ? {
          id: "blacklist",
          label: blacklisted ? "Убрать из чёрного списка" : "В чёрный список",
          icon: Ban,
          color: blacklisted ? t.accent : t.danger,
          onPress: handlers.onToggleBlacklist,
        }
      : null,
    handlers.onDelete
      ? { id: "delete", label: "Удалить", icon: Trash2, color: t.danger, onPress: handlers.onDelete }
      : null,
  ];
  return items.filter((item): item is PickerSheetItem => item !== null);
}
