import { useState } from "react";
import { ScrollView } from "react-native";
import { KeyRound } from "lucide-react-native";
import { KeyboardLift } from "@/components/ui/KeyboardLift";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { ColumnDoorRow } from "@/components/ui/card-rows";
import { Divider } from "@/components/ui/Divider";
import { SETTINGS_ROW_INSET } from "@/components/ui/tokens";
import { PERSON_COLUMN } from "@/features/clients/contact-column";
import { useSession } from "@/providers/SessionProvider";
import { ChangeEmailSheet } from "@/features/cabinet/ChangeEmailSheet";
import { DangerZoneSection } from "./DangerZoneSection";
import { DevicesSection } from "./DevicesSection";
import { PasswordSheet } from "./PasswordSection";
import { TwoFactorRow, useTotpFactor } from "./TwoFactorSection";
import { twoFactorOffered } from "./two-factor";

// «ВХОД И БЕЗОПАСНОСТЬ» — СТРОКИ КАНОНА, КАК ВЕСЬ КАБИНЕТ. Страница жила своей
// вёрсткой: подпись над значением в рамке, три поля пароля прямо в карточке,
// действия голыми ссылками и «Удалить аккаунт» третьим стилем. Теперь каждое
// действие — строка `SettingsRow` с плиткой, правка — в листе с кнопкой в
// футере (пароль, как почта). Служебного «ID пользователя» нет: человеку
// он ничего не говорит, а поддержке хватает почты.
export function AccountScreen() {
  const { session } = useSession();
  const u = session?.user;
  const [emailSheet, setEmailSheet] = useState(false);
  const [passwordSheet, setPasswordSheet] = useState(false);
  const totp = useTotpFactor().data ?? null;
  const registered = u?.created_at
    ? new Date(u.created_at).toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "—";

  return (
    <Screen edges={["top"]}>
      {/* Шапка = строка Кабинета, которой сюда пришли. */}
      <ScreenHeader title="Вход и безопасность" />
      <KeyboardLift style={{ flex: 1 }}>
        <ScrollView
          className="flex-1"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 32 }}
        >
          {/* ДАННЫЕ АККАУНТА — КОЛОНКОЙ, как «Профиль» и карточка партнёра:
              подпись слева, значение рядом. Действия ниже — строками с
              плиткой. */}
          <SectionCard>
            <ColumnDoorRow
              label="Почта"
              value={u?.email}
              placeholder="—"
              column={PERSON_COLUMN}
              onPress={u?.email ? () => setEmailSheet(true) : undefined}
            />
            <ColumnDoorRow
              separated
              label="Регистрация"
              value={registered}
              placeholder="—"
              column={PERSON_COLUMN}
            />
          </SectionCard>

          <SectionCard title="Безопасность">
            <SettingsRow
              tile={SETTINGS_TILE.orange}
              icon={KeyRound}
              title="Сменить пароль"
              sub={totp ? "Нужен код из приложения" : "Нужен текущий пароль"}
              onPress={() => setPasswordSheet(true)}
            />
            {/* Аккаунту проверки Apple двухфакторного входа не даём. */}
            {twoFactorOffered(u?.email) ? (
              <>
                <Divider inset={SETTINGS_ROW_INSET} />
                <TwoFactorRow />
              </>
            ) : null}
          </SectionCard>
          <DevicesSection />
          <DangerZoneSection email={u?.email ?? ""} />
        </ScrollView>
      </KeyboardLift>
      <ChangeEmailSheet
        visible={emailSheet}
        onClose={() => setEmailSheet(false)}
        currentEmail={u?.email ?? ""}
      />
      <PasswordSheet
        visible={passwordSheet}
        onClose={() => setPasswordSheet(false)}
        email={u?.email ?? null}
        totpFactorId={totp?.id ?? null}
      />
    </Screen>
  );
}
