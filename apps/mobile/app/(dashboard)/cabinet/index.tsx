// Кабинет — корневое меню аккаунта в языке веб-«Настроек»
// (apps/web/src/app/dashboard/settings/page.tsx, v316 iOS-26 redesign):
// герой-карта аккаунта с градиентом и инициалами → группы строк с
// цветными icon-тайлами, у каждой строки название + серое описание →
// красная карта «Выйти из аккаунта» → футер «Babun · vX.Y.Z».
//
// НАСТРОЕК РАЗДЕЛОВ ЗДЕСЬ НЕТ (владелец 2026-09-14: «с кабинета чистим, это
// не надо уже: половина не нужна, половина уже есть в настройках календаря,
// в настройках клиентов и в настройках финансов; дублировать в кабинете не
// надо — все настройки там, где открывают шестерёнку»).
//
// Кабинет был хабом всего приложения, и почти каждая настройка жила в двух
// местах: строкой здесь и строкой за шестерёнкой раздела. Теперь у неё одна
// дверь — в разделе, которым пользуются: календарь (часы, метки, запись,
// услуги, мастера и их доступ), клиенты (карточка, типы объектов, импорт),
// финансы (счета, категории, шаблоны операций, реквизиты); Сводка — кнопка в
// шапке Финансов. Тем же решением сняты строки, у которых второй двери не
// было: Закрыть день, Незакрытые дни, Склад, Шаблоны SMS, Программа
// лояльности, Повторяющиеся ТО — экраны остались в коде, входа в них нет.
//
// Здесь остаётся только то, что принадлежит аккаунту, а не разделу:
// приглашения, вход и безопасность, синхронизация, выход. Новую настройку
// раздела сюда не добавлять — её место за шестерёнкой этого раздела.

import type { ComponentType } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { ChevronRight, LogOut, RefreshCw, Shield } from "lucide-react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { DISPLAY_VERSION } from "@babun/shared/common/utils/version";
import { Screen } from "@/components/ui/Screen";
import { TYPE } from "@/components/ui/tokens";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { IncomingInvitations } from "@/features/access/IncomingInvitations";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { useThemeColors } from "@/theme/colors";
import { signOutAndWipe } from "@/lib/auth-clear";
import { useSession } from "@/providers/SessionProvider";
import { useCurrentRole, useTenant } from "@/features/settings/tenant";
import { ROLE_LABELS, type UserRole } from "@/features/settings/role-policy";
import { useQueueDepth } from "@babun/shared/sync";

type IconType = ComponentType<{
  color?: string;
  size?: number;
  strokeWidth?: number;
}>;

// Плитки — из общей палитры `SETTINGS_TILE` (владелец 2026-09-10: «свести к
// фирменному»): своя палитра Кабинета давала два близких синих на одной
// странице рядом с кобальтом бренда.

// Строка меню — анатомия веб-ряда: тайл 30, заголовок 15 medium,
// описание 12 secondary, chevron. Бейдж-счётчик — мобильное дополнение
// (веб-настройки счётчиков не носят, но «Синхронизация» без него слепнет).
function MenuRow({
  icon: Icon,
  tone,
  title,
  desc,
  href,
  badge,
}: {
  icon: IconType;
  tone: string;
  title: string;
  desc: string;
  href: Href;
  badge?: number;
}) {
  const router = useRouter();
  const t = useThemeColors();
  return (
    <Pressable
      onPress={() => router.push(href)}
      accessibilityRole="button"
      accessibilityLabel={title}
      className="min-h-[58px] flex-row items-center gap-3 px-4 py-2.5"
      style={({ pressed }) => ({
        backgroundColor: pressed ? t.pressed : "transparent",
      })}
    >
      <View
        style={{
          height: 30,
          width: 30,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: t.radius.card,
          backgroundColor: tone,
        }}
      >
        <Icon color="#fff" size={18} strokeWidth={2.2} />
      </View>
      <View className="min-w-0 flex-1">
        <Text style={{ fontSize: 15, fontWeight: "500", color: t.ink }} numberOfLines={1}>
          {title}
        </Text>
        <Text style={{ marginTop: 1, fontSize: 12, color: t.sub }} numberOfLines={1}>
          {desc}
        </Text>
      </View>
      {badge ? (
        <View
          style={{
            minWidth: 20,
            height: 20,
            paddingHorizontal: 6,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: t.radius.card,
            backgroundColor: t.warning,
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: "700", color: "#fff" }}>{badge}</Text>
        </View>
      ) : null}
      <ChevronRight color={t.chevron} size={16} />
    </Pressable>
  );
}

// Герой-карта аккаунта (веб AccountHero): градиент accent→indigo→purple
// 135°, кольцо-аватар с инициалами компании, имя + email. Тап ведёт в
// «Личную информацию» — карту с именем компании естественно тыкают,
// чтобы это имя поменять.
function AccountHero({ role }: { role: UserRole | null | undefined }) {
  const t = useThemeColors();
  const router = useRouter();
  const { session } = useSession();
  const { data: tenant } = useTenant();

  const name = (tenant?.name as string | undefined)?.trim() || "Babun";
  const email = session?.user.email ?? "";
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "B";

  return (
    <Pressable
      onPress={() => router.push("/cabinet/business")}
      accessibilityRole="button"
      accessibilityLabel={`${name}, открыть личную информацию`}
      className="mx-3 mt-2 overflow-hidden rounded-[10px]"
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          {/* ГРАДИЕНТ ОДИН НА ПРОДУКТ — ФИРМЕННЫЙ КОБАЛЬТОВЫЙ (владелец
              2026-09-10). Здесь герой-карта уходила через индиго `#5E5CE6` в
              фиолетовый `#9B3DCB` — второй бренд-оттенок, прямо запрещённый
              каноном («единственный градиент — accentFrom → accentTo», «не
              добавляй второй акцент или фиолетовый бренд-оттенок»). Корень
              «Кабинета» был единственным экраном со своим бренд-цветом. */}
          <LinearGradient id="hero" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={t.accentFrom} />
            <Stop offset="1" stopColor={t.accentTo} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#hero)" />
      </Svg>
      <View className="flex-row items-center gap-3 px-4 py-4">
        <View
          style={{
            height: 56,
            width: 56,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: t.radius.card,
            borderWidth: 2,
            borderColor: "rgba(255,255,255,0.7)",
            backgroundColor: "rgba(255,255,255,0.2)",
          }}
        >
          <Text style={{ fontSize: 20, fontWeight: "700", color: "#fff" }}>{initials}</Text>
        </View>
        <View className="min-w-0 flex-1">
          <Text style={{ fontSize: 17, fontWeight: "600", color: "#fff" }} numberOfLines={1}>
            {name}
          </Text>
          {email || role ? (
            <Text
              style={{ marginTop: 2, fontSize: 12, color: "#fff" }}
              numberOfLines={1}
            >
              {role ? ROLE_LABELS[role] : ""}
              {role && email ? " · " : ""}
              {email}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export default function CabinetHome() {
  const t = useThemeColors();
  const { data: role } = useCurrentRole();
  const syncDepth = useQueueDepth();

  return (
    <Screen>
      <View className="px-4 pb-1 pt-4">
        <Text style={{ ...TYPE.display, color: t.ink }}>Кабинет</Text>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 24 }}>
        <AccountHero role={role} />

        {/* ВХОДЯЩИЕ ПРИГЛАШЕНИЯ — СВЕРХУ КАБИНЕТА (владелец 14.09: «всё переводим
            на приглашение в кабинет… отдельный блок приглашения»). Пока
            приглашений нет, блока нет. */}
        <IncomingInvitations />

        <SectionEyebrow>Личный кабинет</SectionEyebrow>
        <SectionCard>
          <MenuRow
            icon={Shield}
            tone={SETTINGS_TILE.orange}
            title="Вход и безопасность"
            desc="Пароль, аккаунт, удаление"
            href="/cabinet/account"
          />
        </SectionCard>

        {role === "owner" || role === "dispatcher" ? (
          <>
            <SectionEyebrow>Приложение</SectionEyebrow>
            <SectionCard>
              <MenuRow
                icon={RefreshCw}
                tone={SETTINGS_TILE.blue}
                title="Синхронизация"
                desc={
                  syncDepth > 0
                    ? "Ожидающие и отклонённые изменения"
                    : "Все изменения переданы на сервер"
                }
                href={"/cabinet/sync" as Href}
                badge={syncDepth}
              />
            </SectionCard>
          </>
        ) : null}

        {/* Выход — красная карта-строка, как в вебе. Wipes tenant-scoped
            MMKV + query cache once signOut succeeds, so the next account
            on this device never sees this tenant's data. */}
        <SectionCard>
          <Pressable
            onPress={() => void signOutAndWipe()}
            accessibilityRole="button"
            accessibilityLabel="Выйти из аккаунта"
            className="min-h-[52px] flex-row items-center justify-center gap-2 px-4 py-3.5"
            style={({ pressed }) => ({
              backgroundColor: pressed ? t.pressed : "transparent",
            })}
          >
            <LogOut color={t.danger} size={16} strokeWidth={2.2} />
            <Text style={{ fontSize: 15, fontWeight: "600", color: t.danger }}>
              Выйти из аккаунта
            </Text>
          </Pressable>
        </SectionCard>

        <Text
          style={{
            paddingVertical: 12,
            textAlign: "center",
            fontSize: 11,
            color: t.faint,
          }}
        >
          Babun · {DISPLAY_VERSION}
        </Text>
      </ScrollView>
    </Screen>
  );
}
