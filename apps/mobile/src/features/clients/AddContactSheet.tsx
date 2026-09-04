import { useRouter } from "expo-router";
import { Phone } from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import { PickerSheet, type PickerSheetItem } from "@/components/ui/PickerSheet";
import {
  contactFieldDef,
  useEnabledContactFields,
  type ContactFieldId,
} from "@/features/clients/contact-fields";
import { useReferenceHref } from "@/features/clients/reference-href";
import { useThemeColors } from "@/theme/colors";

// «ДОБАВИТЬ» — один плюс вместо строки «+ Добавить номер» (владелец
// 2026-08-02: «нажимаешь плюс, снизу вылазит плашка, как выбор метки или
// тега, и сразу одной кнопкой добавляешь WhatsApp, Telegram и так далее»).
//
// Шестерёнка в углу ведёт в настройки клиентов: список — не константа
// продукта, а набор бизнеса, и настраивается там же, где способы связи.
//
// Уже заполненное в листе не показывается: строка такого способа связи и так
// стоит на карточке, и второй раз его не заводят.

export type AddContactChoice = "phone" | ContactFieldId;

export function AddContactSheet({
  visible,
  client,
  onPick,
  onClose,
}: {
  visible: boolean;
  client: Client;
  onPick: (choice: AddContactChoice) => void;
  onClose: () => void;
}) {
  const t = useThemeColors();
  const router = useRouter();
  // Из записи справочник открывается её сиблингом (см. `useReferenceHref`).
  const channelsHref = useReferenceHref().channels;
  const enabled = useEnabledContactFields();

  // Номер — всегда первым и всегда доступен: их у клиента может быть сколько
  // угодно, а мессенджер каждого вида ровно один.
  const items: PickerSheetItem[] = [
    {
      id: "phone",
      label: "Номер телефона",
      icon: Phone,
      color: t.accent,
      onPress: () => onPick("phone"),
    },
    // По ПОРЯДКУ ПОЛЬЗОВАТЕЛЯ (`enabled` уже отсортирован настройкой), а не по
    // порядку константы: иначе перетаскивание в «Способах связи» не доезжало
    // бы до этого листа.
    ...enabled
      .map((id) => contactFieldDef(id))
      .filter((f): f is NonNullable<typeof f> => f !== undefined)
      .filter((f) => f.display(client).trim().length === 0)
      .map(
        (f): PickerSheetItem => ({
          id: f.id,
          label: f.label,
          icon: f.icon,
          color: f.color,
          onPress: () => onPick(f.id),
        }),
      ),
  ];

  return (
    <PickerSheet
      visible={visible}
      title="Добавить"
      items={items}
      // Шестерёнка ведёт на СТРАНИЦУ этого самого списка, а не в общие
      // настройки: закон владельца 2026-08-02 — настройка всегда страница,
      // и она должна открыться ровно там, где её искали.
      onSettings={() => router.push(channelsHref)}
      settingsLabel="Способы связи"
      onClose={onClose}
    />
  );
}

export default AddContactSheet;
