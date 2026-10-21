import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import Head from "expo-router/head";
import { CalendarDays, Users, Wallet, UsersRound, type LucideIcon } from "lucide-react-native";

import { BrandLockup } from "@/components/brand/BrandMark";
import { GradientButton } from "@/components/ui/GradientButton";
import { Screen } from "@/components/ui/Screen";
import { GUTTER, TYPE } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";

import { LEGAL_OPERATOR, legalEmail } from "./operator";

// babun.app/about — О BABUN БЕЗ ВХОДА (проверка оформления Google).
//
// Google отказал в показе названия и логотипа в окне входа: «главная страница
// закрыта входом» и «не объясняет, зачем приложение». Здесь — что такое Babun,
// для кого, что в нём есть, зачем вход через Google, и ссылки на политику,
// условия и поддержку. Адрес этой страницы стоит «Application home page» в
// Branding проекта Google babun-495509. Ни цен, ни оплаты — это страница о
// продукте, а не витрина.

const READ_WIDTH = 720;

const FEATURES: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: CalendarDays, title: "Календарь", text: "Записи и события команд на день, неделю и месяц." },
  { icon: Users, title: "Клиенты", text: "Контакты, адреса, объекты и история работ по каждому клиенту." },
  { icon: Wallet, title: "Финансы", text: "Доходы и расходы, счета, инвойсы и долги клиентов." },
  { icon: UsersRound, title: "Команда", text: "Партнёры с правами доступа по каждой команде." },
];

const LINKS: { label: string; href: Href }[] = [
  { label: "Политика конфиденциальности", href: "/privacy" as Href },
  { label: "Условия использования", href: "/terms" as Href },
  { label: "Поддержка", href: "/support" as Href },
];

export function AboutScreen() {
  const t = useThemeColors();
  const router = useRouter();

  return (
    <Screen edges={["top"]}>
      {Platform.OS === "web" ? (
        <Head>
          <title>Babun — CRM</title>
          <meta
            name="description"
            content="Babun — CRM для выездных мастеров и сервисных команд: календарь записей, клиенты, объекты и финансы."
          />
        </Head>
      ) : null}
      <ScrollView contentContainerStyle={{ paddingHorizontal: GUTTER, paddingTop: 24, paddingBottom: 48 }}>
        <View style={{ width: "100%", maxWidth: READ_WIDTH, alignSelf: "center", gap: 20 }}>
          <BrandLockup size={40} />

          <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={{ ...TYPE.display, color: t.ink }}>
            CRM для выездных мастеров и сервисных команд
          </Text>
          <Text maxFontSizeMultiplier={1.4} style={{ ...TYPE.body, color: t.sub }}>
            Babun собирает в одном приложении календарь записей, клиентов, объекты и финансы. Для тех, кто работает на выезде: монтаж и обслуживание техники, ремонт, уборка и другие услуги.
          </Text>

          <View style={{ gap: 12 }}>
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <View
                key={title}
                style={{
                  flexDirection: "row",
                  gap: 14,
                  alignItems: "flex-start",
                  padding: 16,
                  borderRadius: t.radius.card,
                  backgroundColor: t.surface,
                }}
              >
                <Icon color={t.accent} size={22} strokeWidth={1.8} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text maxFontSizeMultiplier={1.3} style={{ ...TYPE.headline, color: t.ink }}>
                    {title}
                  </Text>
                  <Text maxFontSizeMultiplier={1.4} style={{ ...TYPE.subhead, color: t.sub }}>
                    {text}
                  </Text>
                </View>
              </View>
            ))}
          </View>

          <Text maxFontSizeMultiplier={1.4} style={{ ...TYPE.subhead, color: t.sub }}>
            Войти можно почтой и паролем или через Google. Вход через Google нужен только для входа в ваш аккаунт Babun: мы получаем ваше имя и адрес почты и ничего не публикуем от вашего имени.
          </Text>

          <View style={{ maxWidth: 360 }}>
            <GradientButton label="Войти в Babun" onPress={() => router.push("/login" as Href)} />
          </View>

          <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 20, rowGap: 8, paddingTop: 8 }}>
            {LINKS.map((link) => (
              <Pressable
                key={link.label}
                onPress={() => router.push(link.href)}
                accessibilityRole="link"
                hitSlop={8}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <Text style={{ ...TYPE.callout, color: t.accent }}>{link.label}</Text>
              </Pressable>
            ))}
          </View>

          <Text maxFontSizeMultiplier={1.3} style={{ ...TYPE.caption, color: t.faint }}>
            {`© Babun · ${LEGAL_OPERATOR.name} · ${LEGAL_OPERATOR.address} · ${legalEmail()}`}
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}
