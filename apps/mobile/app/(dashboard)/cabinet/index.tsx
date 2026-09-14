// Кабинет — ЛИЧНОЕ ПРОСТРАНСТВО ЧЕЛОВЕКА во всей системе (владелец
// 2026-09-15: «как компании не будет, будет только как личное»; «там то, что
// относится ко всей системе: синхронизация, вход и безопасность,
// приглашения…»).
//
// НАСТРОЕК РАЗДЕЛОВ ЗДЕСЬ НЕТ (владелец 2026-09-14: «дублировать в кабинете не
// надо — все настройки там, где открывают шестерёнку»). Календарь, клиенты и
// финансы настраиваются за шестерёнкой своего раздела. Строки без второй двери
// (Закрыть день, Незакрытые дни, Склад, Шаблоны SMS, Программа лояльности,
// Повторяющиеся ТО) сняты тем же решением; их экраны остались в коде.
//
// Здесь только то, что принадлежит человеку и этому устройству: карта
// человека → «Профиль», приглашения в компании, вход и безопасность,
// синхронизация, выход. Строки — канонический `SettingsRow`, как за
// шестерёнками разделов. Новую настройку раздела сюда не добавлять.

import { ScrollView, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { RefreshCw, Shield } from "lucide-react-native";
import { DISPLAY_VERSION } from "@babun/shared/common/utils/version";
import { useQueueDepth } from "@babun/shared/sync";
import { ActionRow } from "@/components/ui/card-rows";
import { Divider } from "@/components/ui/Divider";
import { Screen } from "@/components/ui/Screen";
import { SectionCard } from "@/components/ui/SectionCard";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { TYPE } from "@/components/ui/tokens";
import { InvitationsRow } from "@/features/access/InvitationsRow";
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

        {/* ПРИГЛАШЕНИЯ — СТРОКОЙ НА ПОСТОЯННОМ МЕСТЕ. Прежний блок появлялся
            только при приглашениях, и владелец его не нашёл (2026-09-15). Число
            справа — сколько ждут ответа; внутри страница с карточками. */}
        <SectionCard>
          <InvitationsRow />
        </SectionCard>

        <SectionCard>
          <SettingsRow
            tile={SETTINGS_TILE.orange}
            icon={Shield}
            title="Вход и безопасность"
            sub="Пароль, устройства, удаление аккаунта"
            onPress={() => router.push("/cabinet/account")}
          />
          {showSync ? (
            <>
              <Divider inset={56} />
              <SettingsRow
                tile={SETTINGS_TILE.blue}
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

        {/* ВЫХОД — ОДИН НА ПРИЛОЖЕНИЕ И ТОЛЬКО С ЭТОГО УСТРОЙСТВА
            (`signOutAndWipe` → `scope: "local"`). Выход со всех устройств —
            явной строкой в «Вход и безопасность». */}
        <SectionCard>
          <ActionRow
            label="Выйти из аккаунта"
            tone="danger"
            onPress={() => void signOutAndWipe()}
          />
        </SectionCard>

        <Text
          style={{
            paddingVertical: 12,
            textAlign: "center",
            ...TYPE.subhead,
            color: t.caption,
          }}
        >
          Babun · {DISPLAY_VERSION}
        </Text>
      </ScrollView>
    </Screen>
  );
}
