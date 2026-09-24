// Кабинет — ЛИЧНОЕ ПРОСТРАНСТВО ЧЕЛОВЕКА во всей системе (владелец
// 2026-09-15: «как компании не будет, будет только как личное»; «продумай всё
// максимально… максимально удобно и информативно»).
//
// НАСТРОЕК РАЗДЕЛОВ ЗДЕСЬ НЕТ (владелец 2026-09-14: «дублировать в кабинете не
// надо — все настройки там, где открывают шестерёнку»). Календарь, клиенты и
// финансы настраиваются за шестерёнкой своего раздела.
//
// Состав — то, что принадлежит человеку и этому телефону, и у каждой строки
// подпись с живым состоянием, а не пояснение:
//   • карта человека → «Профиль»;
//   • МОИ КОМПАНИИ — приглашения и компании, где он состоит (роль, календари);
//   • КОМПАНИЯ — «Архив» (только владельцу): удалённые календари, откуда их
//     возвращают или стирают навсегда. Это не настройка раздела, а место
//     хранения — и поставил его сюда сам владелец (2026-09-21: «архив засунь
//     в Кабинет»);
//   • ЭТОТ ТЕЛЕФОН — уведомления и синхронизация;
//   • АККАУНТ — вход и безопасность, «О приложении» (там же версия, поэтому
//     отдельной подписи версии внизу нет);
//   • выход только с этого устройства.
// Новую настройку раздела сюда не добавлять — её место за шестерёнкой.

import { ScrollView, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { RefreshCw, Shield } from "lucide-react-native";
import { useQueueDepth } from "@babun/shared/sync";
import { ActionRow } from "@/components/ui/card-rows";
import { Divider } from "@/components/ui/Divider";
import { Screen } from "@/components/ui/Screen";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { TYPE } from "@/components/ui/tokens";
import { AboutRow } from "@/features/cabinet/AboutRow";
import { ArchiveRow } from "@/features/cabinet/ArchiveRow";
import { CompaniesSection } from "@/features/cabinet/CompaniesSection";
import { NotificationsRow } from "@/features/cabinet/NotificationsRow";
import { PersonCard } from "@/features/cabinet/PersonCard";
import { useCurrentRole } from "@/features/settings/tenant";
import { signOutAndWipe } from "@/lib/auth-clear";
import { useThemeColors } from "@/theme/colors";

export default function CabinetHome() {
  const t = useThemeColors();
  const router = useRouter();
  const { data: role } = useCurrentRole();
  const syncDepth = useQueueDepth();
  // Очередь выгрузки видят те, кто правит данные офлайн, — как и прежде.
  const showSync = role === "owner" || role === "dispatcher";

  return (
    <Screen>
      <View className="px-4 pb-1 pt-4">
        <Text style={{ ...TYPE.display, color: t.ink }}>Кабинет</Text>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 24 }}>
        <PersonCard onPress={() => router.push("/cabinet/profile" as Href)} />

        <CompaniesSection />

        {/* АРХИВ — ТОЛЬКО ВЛАДЕЛЬЦУ: в архив календарь уводит он, и только
            он может вернуть его или стереть. Экран `/cabinet/archive` закрыт
            для остальных тем же правилом, что и весь Кабинет. */}
        {role === "owner" ? (
          <>
            <SectionEyebrow>Компания</SectionEyebrow>
            <SectionCard>
              <ArchiveRow />
            </SectionCard>
          </>
        ) : null}

        <SectionEyebrow>Этот телефон</SectionEyebrow>
        <SectionCard>
          <NotificationsRow />
          {showSync ? (
            <>
              <Divider inset={48} />
              <SettingsRow
                // Своего пигмента у синхронизации нет: зелёный уже носят
                // «Приглашения», и два одинаковых якоря на экране глаз спутает.
                tile="neutral"
                icon={RefreshCw}
                title="Синхронизация"
                sub={syncDepth > 0 ? "Ждут отправки" : "Все изменения на сервере"}
                value={syncDepth > 0 ? String(syncDepth) : undefined}
                valueColor={t.warning}
                onPress={() => router.push("/cabinet/sync" as Href)}
              />
            </>
          ) : null}
        </SectionCard>

        <SectionEyebrow>Аккаунт</SectionEyebrow>
        <SectionCard>
          <SettingsRow
            // Своего пигмента у безопасности в словаре `SETTINGS_TILE` нет:
            // голый глиф, как у «Часового пояса».
            tile="neutral"
            icon={Shield}
            title="Вход и безопасность"
            sub="Пароль, устройства, удаление аккаунта"
            onPress={() => router.push("/cabinet/account")}
          />
          <Divider inset={48} />
          <AboutRow />
        </SectionCard>

        {/* ВЫХОД — ОДИН НА ПРИЛОЖЕНИЕ И ТОЛЬКО С ЭТОГО УСТРОЙСТВА
            (`signOutAndWipe` → `scope: "local"`). Выход со всех устройств —
            явной строкой в «Вход и безопасность». */}
        <SectionCard className="mt-4">
          <ActionRow
            label="Выйти из аккаунта"
            tone="danger"
            onPress={() => void signOutAndWipe()}
          />
        </SectionCard>
      </ScrollView>
    </Screen>
  );
}
