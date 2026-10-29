import { useRouter, type Href } from "expo-router";
import { LifeBuoy } from "lucide-react-native";

import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";

import { SUPPORT_CONTACTS, supportRows } from "./help";

// «ПОМОЩЬ» — СТРОКА-ДВЕРЬ КАБИНЕТА. Подпись называет то, что за
// дверью есть сегодня: пока контактов поддержки нет, там одни вопросы — и строка
// не обещает связь. Зелёный — «наружу»: за дверью связь с поддержкой.
export function HelpRow() {
  const router = useRouter();
  const hasContacts = supportRows(SUPPORT_CONTACTS).length > 0;
  return (
    <SettingsRow
      tile={SETTINGS_TILE.green}
      icon={LifeBuoy}
      title="Помощь"
      sub={hasContacts ? "Вопросы и связь с поддержкой" : "Частые вопросы"}
      onPress={() => router.push("/cabinet/help" as Href)}
    />
  );
}
