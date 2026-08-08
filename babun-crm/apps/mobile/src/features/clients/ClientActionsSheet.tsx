import { Archive, Bell, CalendarPlus, Check, Pin } from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import { PickerSheet, type PickerSheetItem } from "@/components/ui/PickerSheet";
import { useLastNonNull } from "@/lib/use-last-non-null";
import { useThemeColors } from "@/theme/colors";

// МЕНЮ КЛИЕНТА по long-press в списке.
//
// СВЯЗИ ЗДЕСЬ НЕТ (2026-08-06). Раньше первыми тремя строками стояли
// «Позвонить · Сообщение · WhatsApp» — те же действия, что в зелёной кнопке
// строки и на обоих свайпах: четыре дороги к одному глаголу. Хуже, эти три
// строки НЕ читали настройку «Способы связи»: тенант, выключивший SMS, всё
// равно её здесь получал, а Telegram и Viber не появлялись никогда. Связь
// живёт ровно в одном месте — в кнопке у номера, которая уважает и набор, и
// порядок каналов.
//
// Осталось то, чего в кнопке нет: записать, отложить, пометить, убрать.
// «Записать» и «Напомнить» продублированы свайпами (вправо/влево) — жест
// быстрее, лист обнаруживаемее, и по закону продукта у действия должна быть
// видимая дорога, а не только жест.
//
// Сам лист — канонический `PickerSheet`: был самописный `Modal
// animationType="slide"`, что DS запрещает дословно.

interface ClientActionsSheetProps {
  /** null → лист закрыт. */
  client: Client | null;
  onClose: () => void;
  onBook: (c: Client) => void;
  onSelectMany: (c: Client) => void;
  onTogglePin: (c: Client) => void;
  onRemind: (c: Client) => void;
  onArchive: (c: Client) => void;
}

export function ClientActionsSheet({
  client,
  onClose,
  onBook,
  onSelectMany,
  onTogglePin,
  onRemind,
  onArchive,
}: ClientActionsSheetProps) {
  const t = useThemeColors();
  // Держим последнего клиента, пока лист уезжает: ранний `return null` на
  // закрытии размонтировал лист в том же кадре, и вся выездная анимация
  // BottomSheet не проигрывалась — панель просто исчезала.
  const shown = useLastNonNull(client);
  if (!shown) return null;

  const pinned = Boolean(shown.pinned_at);
  const c = shown;
  const items: PickerSheetItem[] = [
    {
      id: "book",
      label: "Записать",
      icon: CalendarPlus,
      color: t.accent,
      onPress: () => onBook(c),
    },
    {
      id: "remind",
      label: "Напомнить",
      icon: Bell,
      color: t.warning,
      onPress: () => onRemind(c),
    },
    {
      id: "pin",
      label: pinned ? "Открепить" : "Закрепить",
      icon: Pin,
      color: t.accent,
      onPress: () => onTogglePin(c),
    },
    {
      id: "select",
      label: "Выбрать несколько",
      icon: Check,
      color: t.accent,
      onPress: () => onSelectMany(c),
    },
    {
      id: "archive",
      label: "В архив",
      icon: Archive,
      color: t.danger,
      onPress: () => onArchive(c),
    },
  ];

  return (
    <PickerSheet
      visible={client !== null}
      title={c.full_name || c.phone || "Клиент"}
      items={items}
      onClose={onClose}
    />
  );
}

export default ClientActionsSheet;
