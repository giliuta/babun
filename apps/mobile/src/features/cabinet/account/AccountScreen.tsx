import { useState } from "react";
import { ScrollView } from "react-native";
import { CalendarDays, KeyRound, Mail } from "lucide-react-native";
import { KeyboardLift } from "@/components/ui/KeyboardLift";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { Divider } from "@/components/ui/Divider";
import { useSession } from "@/providers/SessionProvider";
import { ChangeEmailSheet } from "@/features/cabinet/ChangeEmailSheet";
import { DangerZoneSection } from "./DangerZoneSection";
import { DevicesSection } from "./DevicesSection";
import { PasswordSheet } from "./PasswordSection";

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
          <SectionCard>
            <SettingsRow
              tile={SETTINGS_TILE.blue}
              icon={Mail}
              title="Почта"
              sub={u?.email ?? "—"}
              onPress={u?.email ? () => setEmailSheet(true) : undefined}
            />
            <Divider inset={56} />
            <SettingsRow
              tile={SETTINGS_TILE.teal}
              icon={CalendarDays}
              title="Зарегистрирован"
              sub={registered}
            />
          </SectionCard>

          <SectionCard title="Безопасность">
            <SettingsRow
              tile={SETTINGS_TILE.orange}
              icon={KeyRound}
              title="Сменить пароль"
              sub="Нужен текущий пароль"
              onPress={() => setPasswordSheet(true)}
            />
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
      />
    </Screen>
  );
}
