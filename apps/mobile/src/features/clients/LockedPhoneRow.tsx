import { Phone } from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import { FieldRow, RowActionButton } from "@/components/ui/card-rows";
import { useOpenMemberContacts } from "@/features/clients/use-member-contacts";
import { useThemeColors } from "@/theme/colors";
import { CONTACT_COLUMN } from "@/features/clients/contact-column";

// СТРОКА НОМЕРА, КОТОРЫЙ СОТРУДНИКУ ЕЩЁ НЕ ОТКРЫЛИ.
//
// Место номера в блоке «Клиент» не пропадает — пропадают цифры. Кнопка
// звонка в хвосте та же, что у открытого номера: тап открывает номер (дверь
// с журналом), и строка становится обычной — с цифрами и звонком. Кнопки
// внутри содержимого нет: действие — прежний звонок. `right` — строки нет
// вовсе: права на телефоны нет, и блок молчит.

export function LockedPhoneRow({ client }: { client: Client }) {
  const t = useThemeColors();
  const { open } = useOpenMemberContacts();
  if (client.contacts_hidden === "right") return null;
  return (
    <FieldRow
      label="Телефон"
      column={CONTACT_COLUMN}
      separated
      value="•• ••• •••"
      placeholder="Телефон"
      readOnly
      noCopy
      tabular
      valueColor={t.sub}
      onSave={() => undefined}
      trailing={
        <RowActionButton
          icon={Phone}
          color={t.accent}
          label="Открыть номер"
          hint="Каждое открытие видно владельцу"
          onPress={() => void open(client)}
        />
      }
    />
  );
}
