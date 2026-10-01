import { ScrollView, Text } from "react-native";

import { FieldRow, RowGroup } from "@/components/ui/card-rows";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { TYPE } from "@/components/ui/tokens";
import { CONTACT_COLUMN } from "@/features/clients/contact-column";
import { useDefaultCountry } from "@/features/clients/default-country";
import { usePhoneCodeField } from "@/features/clients/use-phone-country";
import { notify } from "@/lib/notify";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/providers/SessionProvider";
import { useThemeColors } from "@/theme/colors";

import { phoneToSave, profileFromMetadata } from "./profile";

// «ПРОФИЛЬ» — КУДА ВЕДЁТ КАРТА ЧЕЛОВЕКА В КАБИНЕТЕ (007 и 008, 15.09: «Кабинет —
// личное, герой — человек»). Имя и телефон, с пометкой «не подтверждён», пока
// нет SMS. Почты здесь нет намеренно: это вход в аккаунт, она живёт во «Вход и
// безопасность» и строкой на карте человека. Строки — канонические `FieldRow`:
// правка на месте, запись по уходу со строки, без кнопки «Сохранить».
export function ProfileScreen() {
  const t = useThemeColors();
  const { session } = useSession();
  const profile = profileFromMetadata(session?.user.user_metadata);

  const save = async (data: Record<string, string | boolean | null>) => {
    const { error } = await supabase.auth.updateUser({ data });
    if (error) notify("Не удалось сохранить", error.message);
  };
  // КОД СТРАНЫ — ТИХИМ ПРЕФИКСОМ, ЦИФРЫ — В ПОЛЕ (владелец 01.10: «обязательно
  // код страны — выбирать код, потом писать номер»), как номер клиента.
  const phoneField = usePhoneCodeField({
    phone: profile.phone ?? "",
    home: useDefaultCountry(),
    onSave: (full) => {
      const phone = phoneToSave(full);
      if (phone === undefined) {
        notify("Проверьте номер", "Номер не похож на телефон. Проверьте код страны и цифры.");
        return;
      }
      void save({ phone, phone_verified: false });
    },
  });

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Профиль" />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <RowGroup>
          {/* ПОДПИСЬ СЛЕВА КОЛОНКОЙ, КАК В БЛОКЕ «КЛИЕНТ» (01.10): в этой
              раскладке у номера стоит тихий код страны, который меняется
              тапом. */}
          <FieldRow
            label="Имя"
            column={CONTACT_COLUMN}
            value={profile.name}
            placeholder="Имя"
            autoCapitalize="words"
            onSave={(value) => void save({ full_name: value })}
          />
          <FieldRow
            separated
            label="Телефон"
            column={CONTACT_COLUMN}
            tabular
            prefix={phoneField.prefix}
            onPrefixPress={phoneField.onPrefixPress}
            value={phoneField.value}
            placeholder="Номер"
            keyboardType="phone-pad"
            trailing={
              profile.phone && !profile.phoneVerified ? (
                <Text style={{ ...TYPE.subhead, color: t.caption }}>не подтверждён</Text>
              ) : null
            }
            onSave={phoneField.onSave}
          />
        </RowGroup>
        {phoneField.sheet}
      </ScrollView>
    </Screen>
  );
}
