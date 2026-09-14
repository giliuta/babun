import { ScrollView, Text } from "react-native";

import { FieldRow, RowGroup } from "@/components/ui/card-rows";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { TYPE } from "@/components/ui/tokens";
import { formatPhoneAsYouType } from "@/features/clients/phone";
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

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Профиль" />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <RowGroup>
          <FieldRow
            stacked
            big
            label="Имя"
            value={profile.name}
            placeholder="Имя"
            addLabel="Добавить имя"
            autoCapitalize="words"
            onSave={(value) => void save({ full_name: value })}
          />
          <FieldRow
            stacked
            big
            separated
            label="Телефон"
            value={profile.phone ? formatPhoneAsYouType(profile.phone) : ""}
            placeholder="Телефон"
            addLabel="Добавить телефон"
            keyboardType="phone-pad"
            trailing={
              profile.phone && !profile.phoneVerified ? (
                <Text style={{ ...TYPE.subhead, color: t.caption }}>не подтверждён</Text>
              ) : null
            }
            onSave={(value) => {
              const phone = phoneToSave(value);
              if (phone === undefined) {
                notify("Проверьте номер", "Номер не похож на телефон. Введите его с кодом страны.");
                return;
              }
              void save({ phone, phone_verified: false });
            }}
          />
        </RowGroup>
      </ScrollView>
    </Screen>
  );
}
