import { Fragment, useState } from "react";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import {
  ChevronDown,
  ChevronUp,
  FileText,
  Mail,
  MessageCircle,
  Send,
  type LucideIcon,
} from "lucide-react-native";

import { Divider } from "@/components/ui/Divider";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { useToast } from "@/components/ui/Toast";
import { CAN_PAY_HERE } from "@/lib/pay-here";
import { useThemeColors } from "@/theme/colors";

import { versionSummary } from "./about";
import { appBuildFacts } from "./app-facts";
import {
  helpFaq,
  LEGAL_LINKS,
  SUPPORT_CONTACTS,
  supportLink,
  supportRows,
  type HelpFaqItem,
  type SupportChannel,
  type SupportRow,
} from "./help";

// СТРАНИЦА «ПОМОЩЬ» (Кабинет, 03.10). Что в ней и почему «Связаться» может не
// быть вовсе — в шапке `help.ts`.
//
// «Связаться» — строки-двери во внешние приложения (WhatsApp, Telegram, почта).
// «Частые вопросы» — строки без дверей: тап раскрывает ответ под вопросом, тут
// же, без перехода. Открыт один вопрос за раз — длинный список не вырастает в
// простыню.
//
// «Документы» (04.10, выпуск в магазины) — политика, условия, удаление
// аккаунта: Apple требует, чтобы политика открывалась из самого приложения.
// Тот же экран без входа — babun.app/support (адрес поддержки в карточках
// магазинов). В приложении из магазина вопросы об оплате скрыты (`helpFaq`).

const CONTACT_ICON: Record<SupportChannel, LucideIcon> = {
  whatsapp: MessageCircle,
  telegram: Send,
  email: Mail,
};

const CONTACT_TILE: Record<SupportChannel, string> = {
  whatsapp: SETTINGS_TILE.green,
  telegram: SETTINGS_TILE.blue,
  email: SETTINGS_TILE.indigo,
};

// Вшитый отступ разделителя: поле строки 16 + плитка 28 + зазор 12.
const TILE_ROW_INSET = 56;

export function HelpScreen() {
  const toast = useToast();
  const router = useRouter();
  const faq = helpFaq(CAN_PAY_HERE);
  const [openId, setOpenId] = useState<string | null>(null);
  const contacts = supportRows(SUPPORT_CONTACTS);

  const handleContact = (row: SupportRow) => {
    // В письме — та же версия, что на «О приложении»: на телефоне — версия
    // магазина и номер сборки, на сайте — внутренняя.
    Linking.openURL(supportLink(row, versionSummary(appBuildFacts()))).catch(() => {
      // Нет приложения под ссылку (например, почты) — сказать, а не молчать.
      toast("Не удалось открыть", "error");
    });
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Помощь" />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        {contacts.length > 0 ? (
          <SectionCard title="Связаться">
            {contacts.map((row, index) => (
              <Fragment key={row.channel}>
                {index > 0 ? <Divider inset={TILE_ROW_INSET} /> : null}
                <SettingsRow
                  tile={CONTACT_TILE[row.channel]}
                  icon={CONTACT_ICON[row.channel]}
                  title={row.title}
                  sub={row.sub}
                  onPress={() => handleContact(row)}
                />
              </Fragment>
            ))}
          </SectionCard>
        ) : null}

        <SectionCard title="Частые вопросы">
          {faq.map((item, index) => (
            <Fragment key={item.id}>
              {index > 0 ? <Divider inset={16} /> : null}
              <FaqRow
                item={item}
                open={openId === item.id}
                onToggle={() => setOpenId(openId === item.id ? null : item.id)}
              />
            </Fragment>
          ))}
        </SectionCard>

        <SectionCard title="Документы">
          {LEGAL_LINKS.map((link, index) => (
            <Fragment key={link.href}>
              {index > 0 ? <Divider inset={48} /> : null}
              <SettingsRow
                tile="neutral"
                icon={FileText}
                title={link.title}
                onPress={() => router.push(link.href as Href)}
              />
            </Fragment>
          ))}
        </SectionCard>
      </ScrollView>
    </Screen>
  );
}

// Default-экспорт — для файла маршрута `app/cabinet/help.tsx`.
export default HelpScreen;

// Строка вопроса: кегль и вес названия те же, что у `SettingsRow` (17/500), ответ
// тише и мельче (15/400, `sub`). Нажимается вся строка вместе с ответом —
// свернуть можно тапом по тексту, не целясь в шеврон.
function FaqRow({
  item,
  open,
  onToggle,
}: {
  item: HelpFaqItem;
  open: boolean;
  onToggle: () => void;
}) {
  const t = useThemeColors();
  const Chevron = open ? ChevronUp : ChevronDown;
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={item.question}
      accessibilityState={{ expanded: open }}
      style={({ pressed }) => ({
        paddingHorizontal: 16,
        paddingVertical: 14,
        backgroundColor: pressed ? t.pressed : "transparent",
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Text
          maxFontSizeMultiplier={1.2}
          style={{
            flex: 1,
            fontSize: 17,
            lineHeight: 22,
            fontWeight: "500",
            color: t.ink,
          }}
        >
          {item.question}
        </Text>
        <Chevron color={t.chevron} size={16} strokeWidth={1.75} />
      </View>
      {open ? (
        <Text
          maxFontSizeMultiplier={1.2}
          style={{
            marginTop: 6,
            // Ответ не ложится под шеврон: справа от текста остаётся его место.
            marginRight: 28,
            fontSize: 15,
            lineHeight: 20,
            fontWeight: "400",
            color: t.sub,
          }}
        >
          {item.answer}
        </Text>
      ) : null}
    </Pressable>
  );
}
