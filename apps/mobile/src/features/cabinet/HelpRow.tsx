import { useRouter, type Href } from "expo-router";
import { LifeBuoy } from "lucide-react-native";

import { SettingsRow } from "@/components/ui/SettingsRow";

import { SUPPORT_CONTACTS, supportRows } from "./help";

// «ПОМОЩЬ» — СТРОКА-ДВЕРЬ КАБИНЕТА (владелец 03.10). Подпись называет то, что за
// дверью есть сегодня: пока контактов поддержки нет, там одни вопросы — и строка
// не обещает связь. Плитка нейтральная, как у «О приложении»: пигмента «помощь»
// в словаре `SETTINGS_TILE` нет.
export function HelpRow() {
  const router = useRouter();
  const hasContacts = supportRows(SUPPORT_CONTACTS).length > 0;
  return (
    <SettingsRow
      tile="neutral"
      icon={LifeBuoy}
      title="Помощь"
      sub={hasContacts ? "Вопросы и связь с поддержкой" : "Частые вопросы"}
      onPress={() => router.push("/cabinet/help" as Href)}
    />
  );
}
