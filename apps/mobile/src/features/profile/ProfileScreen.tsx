import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";

import { DateWheelSheet } from "@/components/ui/DateWheelSheet";
import { FieldRow } from "@/components/ui/card-rows";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { TYPE } from "@/components/ui/tokens";
import { useOwnAccountId, useOwnAccountName, useRenameOwnAccount } from "@/features/cabinet/own-account-name";
import { birthdayText } from "@/features/cabinet/person-card";
import { formatYMD } from "@/features/appointments/helpers";
import { useDefaultCountry } from "@/features/clients/default-country";
import { usePhoneCodeField } from "@/features/clients/use-phone-country";
import { haptics } from "@/lib/haptics";
import { notify } from "@/lib/notify";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/providers/SessionProvider";
import { useThemeColors } from "@/theme/colors";

import { phoneToSave, profileFromMetadata } from "./profile";

// «ПРОФИЛЬ» — КУДА ВЕДЁТ КАРТА ЧЕЛОВЕКА В КАБИНЕТЕ (007 и 008, 15.09: «Кабинет —
// личное, герой — человек»). Строки — канонические `FieldRow` колонкой
// подписей: правка на месте, запись по уходу со строки, без «Сохранить».
//
// ПОЛНАЯ ВИЗИТКА (владелец 06.10: «имя, имя компании, дата рождения, почта,
// номер — полноценно и информативно»), блоками с шапкой, как страница клиента:
//   • «Личное» — имя и день рождения (барабаном, как у клиента);
//   • «Компания» — имя своего аккаунта, его видят партнёры; только у того, у
//     кого свой аккаунт есть;
//   • «Связь» — телефон (код страны тихим префиксом, «не подтверждён», пока
//     нет SMS) и почта — только показанием, менять её здесь владелец не стал.
/** Колонка подписей шире, чем у клиента (96): «День рождения» в 96 не
 *  влезает, а колонка на странице одна на все блоки. */
const PROFILE_COLUMN = 124;

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

  const door = (label: string, value: string, placeholder: string, onPress: () => void, separated?: boolean) => (
    <View>
      {separated ? (
        <View style={{ height: 1, marginLeft: 16 + PROFILE_COLUMN, backgroundColor: t.separator }} />
      ) : null}
      <Pressable
        onPress={() => {
          haptics.tap();
          onPress();
        }}
        accessibilityRole="button"
        accessibilityLabel={value ? `${label}, ${value}` : label}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          minHeight: 44,
          paddingLeft: 16,
          paddingRight: 12,
          paddingVertical: 2,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Text
          maxFontSizeMultiplier={1.2}
          numberOfLines={1}
          style={{ width: PROFILE_COLUMN, fontSize: 15, color: t.caption, paddingRight: 8 }}
        >
          {label}
        </Text>
        <Text
          maxFontSizeMultiplier={1.2}
          numberOfLines={1}
          style={{ flex: 1, fontSize: 17, color: value ? t.ink : t.placeholder }}
        >
          {value || placeholder}
        </Text>
        <ChevronRight color={t.faint} size={16} strokeWidth={1.75} />
      </Pressable>
    </View>
  );

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Профиль" />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <SectionCard title="Личное">
          <FieldRow
            label="Имя"
            column={PROFILE_COLUMN}
            value={profile.name}
            placeholder="Имя"
            autoCapitalize="words"
            onSave={(value) => void save({ full_name: value })}
          />
          {door(
            "День рождения",
            birthdayText(profile.birthday),
            "Дата",
            () => setBirthdayOpen(true),
            true,
          )}
        </SectionCard>

        {ownAccount ? (
          <SectionCard title="Компания">
            <FieldRow
              label="Название"
              column={PROFILE_COLUMN}
              value={accountName}
              placeholder="Название компании"
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
          {/* ПОДПИСЬ СЛЕВА КОЛОНКОЙ, КАК В БЛОКЕ «КЛИЕНТ» (01.10): у номера
              тихий код страны, который меняется тапом. */}
          <FieldRow
            label="Телефон"
            column={PROFILE_COLUMN}
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
          {/* ПОЧТА — ТОЛЬКО ПОКАЗАНИЕ (владелец 06.10: «почту тут менять не
              будем»): это вход в аккаунт, её смена живёт во «Вход и
              безопасность». */}
          <FieldRow
            separated
            readOnly
            label="Почта"
            column={PROFILE_COLUMN}
            value={email}
            placeholder="Почта"
            onSave={() => {}}
          />
        </SectionCard>
        {phoneField.sheet}
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
