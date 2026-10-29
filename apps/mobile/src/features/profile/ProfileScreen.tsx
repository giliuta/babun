import { useState } from "react";
import { ScrollView, Text } from "react-native";

import { DateWheelSheet } from "@/components/ui/DateWheelSheet";
import { ColumnDoorRow, FieldRow } from "@/components/ui/card-rows";
import { PERSON_COLUMN } from "@/features/clients/contact-column";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { TYPE } from "@/components/ui/tokens";
import { useOwnAccountId, useOwnAccountName, useRenameOwnAccount } from "@/features/cabinet/own-account-name";
import { birthdayText } from "@/features/cabinet/person-card";
import { formatYMD } from "@/features/appointments/helpers";
import { useDefaultCountry } from "@/features/reference/default-country";
import { usePhoneField } from "@/features/clients/use-phone-country";
import { notify } from "@/lib/notify";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/providers/SessionProvider";
import { useThemeColors } from "@/theme/colors";

import { phoneToSave, profileFromMetadata } from "./profile";

// «ПРОФИЛЬ» — КУДА ВЕДЁТ КАРТА ЧЕЛОВЕКА В КАБИНЕТЕ (Кабинет — личное, герой —
// человек). Строки — канонические `FieldRow` колонкой
// подписей: правка на месте, запись по уходу со строки, без «Сохранить».
//
// ПОЛНАЯ ВИЗИТКА (имя, название аккаунта, дата рождения, почта, номер), блоками с шапкой, как страница клиента:
//   • «Личное» — имя и день рождения (барабаном, как у клиента);
//   • «Аккаунт» — название своего аккаунта, его видят партнёры; только у
//     того, у кого свой аккаунт есть. Слова «компания» в продукте нет: у
//     человека аккаунт и команды;
//   • «Связь» — телефон (код страны тихим префиксом, «не подтверждён», пока
//     нет SMS) и почта — только показанием, менять её здесь нельзя.
/** Колонка подписей шире, чем у клиента (96): «День рождения» в 96 не
 *  влезает, а колонка на странице одна на все блоки. */

export function ProfileScreen() {
  const t = useThemeColors();
  const { session } = useSession();
  const profile = profileFromMetadata(session?.user.user_metadata);
  const email = session?.user.email ?? "";
  const ownAccount = useOwnAccountId();
  const accountName = useOwnAccountName().data ?? "";
  const rename = useRenameOwnAccount();
  const [birthdayOpen, setBirthdayOpen] = useState(false);

  const save = async (data: Record<string, string | boolean | null>) => {
    const { error } = await supabase.auth.updateUser({ data });
    if (error) notify("Не удалось сохранить", error.message);
  };
  // КОД СТРАНЫ — ТИХИМ ПРЕФИКСОМ, ЦИФРЫ — В ПОЛЕ (код страны выбирают, потом пишут
  // номер), как номер клиента.
  const phoneField = usePhoneField({
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
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <SectionCard title="Личное">
          <FieldRow
            label="Имя"
            column={PERSON_COLUMN}
            value={profile.name}
            placeholder="Имя"
            autoCapitalize="words"
            onSave={(value) => void save({ full_name: value })}
          />
          <ColumnDoorRow
            separated
            label="День рождения"
            value={birthdayText(profile.birthday)}
            placeholder="Дата"
            column={PERSON_COLUMN}
            onPress={() => setBirthdayOpen(true)}
          />
        </SectionCard>

        {ownAccount ? (
          <SectionCard title="Аккаунт">
            <FieldRow
              label="Название"
              column={PERSON_COLUMN}
              value={accountName}
              placeholder="Название"
              autoCapitalize="words"
              onSave={(value) => {
                // Без имени аккаунт не живёт: пустое поле — оставить прежнее.
                if (!value) return;
                rename.mutate(value, {
                  onError: (e) => notify("Не удалось сохранить", e.message),
                });
              }}
            />
          </SectionCard>
        ) : null}

        <SectionCard title="Связь">
          {/* ПОДПИСЬ СЛЕВА КОЛОНКОЙ, КАК В БЛОКЕ «КЛИЕНТ»: у номера
              тихий код страны, который меняется тапом. */}
          <FieldRow
            label="Телефон"
            column={PERSON_COLUMN}
            tabular
            seed={phoneField.seed}
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
          {/* ПОЧТА — ТОЛЬКО ПОКАЗАНИЕ: это вход в аккаунт, её смена живёт во «Вход и
              безопасность». */}
          <FieldRow
            separated
            readOnly
            label="Почта"
            column={PERSON_COLUMN}
            value={email}
            placeholder="Почта"
            onSave={() => {}}
          />
        </SectionCard>
      </ScrollView>

      <DateWheelSheet
        visible={birthdayOpen}
        title="День рождения"
        value={profile.birthday || null}
        seed="1990-01-01"
        maximumDate={formatYMD(new Date())}
        clearLabel={profile.birthday ? "Убрать дату" : undefined}
        onApply={(ymd) => {
          void save({ birthday: ymd });
          setBirthdayOpen(false);
        }}
        onClear={() => {
          void save({ birthday: null });
          setBirthdayOpen(false);
        }}
        onClose={() => setBirthdayOpen(false)}
      />
    </Screen>
  );
}
