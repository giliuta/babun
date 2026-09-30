import { Phone } from "lucide-react-native";
import type { Client } from "@babun/shared/local/clients";
import { FieldRow, RowActionButton } from "@/components/ui/card-rows";
import { useOpenMemberContacts } from "@/features/clients/use-member-contacts";
import { useThemeColors } from "@/theme/colors";
import { CONTACT_COLUMN } from "@/features/clients/contact-column";

// СТРОКА НОМЕРА, КОТОРЫЙ СОТРУДНИКУ ЕЩЁ НЕ ОТКРЫЛИ (30.09).
//
// Место номера в блоке «Клиент» не пропадает — пропадают цифры. Кнопка
// звонка в хвосте та же, что у открытого номера: тап открывает номер (дверь
// с журналом), и строка становится обычной — с цифрами и звонком. Кнопки
// внутри содержимого нет (владелец 15.09): действие — прежний звонок.
//   • `day`   — словами «Номер откроется в день записи», без кнопки;
//   • `right` — строки нет вовсе: права на телефоны нет, и блок молчит.

export function LockedPhoneRow({ client }: { client: Client }) {
  const t = useThemeColors();
  const { open } = useOpenMemberContacts();
  if (client.contacts_hidden === "right") return null;
  const day = client.contacts_hidden === "day";
  return (
    <FieldRow
      label="Телефон"
      column={CONTACT_COLUMN}
      value={day ? "Откроется в день записи" : "•• ••• •••"}
      placeholder="Телефон"
      readOnly
      noCopy
      tabular={!day}
      valueColor={t.sub}
      onSave={() => undefined}
      trailing={
        day ? null : (
          <RowActionButton
            icon={Phone}
            color={t.accent}
            label="Открыть номер"
            hint="Каждое открытие видно владельцу"
            onPress={() => void open(client)}
          />
        )
      }
    />
  );
}
