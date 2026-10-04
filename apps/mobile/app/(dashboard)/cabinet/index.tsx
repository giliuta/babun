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
//   • ПРИГЛАШЕНИЯ и под ними — БЛОК КАЖДОГО АККАУНТА, КОТОРЫЙ ПРИГЛАСИЛ
//     (владелец 04.10): шапка — его имя, строки — его команды и то, что он
//     открыл правами «Кабинета» (тариф, оплаты, SMS, реквизиты); страницы
//     открываются и платят за этот аккаунт (`InvitedAccounts`);
//   • КОМАНДЫ (не «Компания»: у владельца нет компаний, есть аккаунт и его
//     команды — 01.10; «Аккаунт» — уже имя секции входа ниже) — «Тариф», «Оплаты тарифа», «Партнёры», «История изменений»,
//     «Реквизиты» (03.10, из шестерёнки «Финансов»: «единый блок на все
//     компании»), «SMS», «Выгрузка данных» и «Архив» — всегда за СВОЙ
//     аккаунт, какой бы ни был открыт на телефоне (04.10, `OwnAccountSection`);
//     реквизиты пригласившего — в его блоке выше. История — кто что
//     менял во всех календарях; выгрузка — только своих команд. SMS — баланс,
//     пополнение и отправка всей компании (владелец 2026-09-29: «баланс и
//     пополнение — это всё будет Кабинет SMS»); шаблоны команд — за
//     шестерёнкой календаря. Архив — удалённые календари, откуда их
//     возвращают или стирают навсегда. Это не настройки раздела, а деньги и
//     место хранения — и поставил их сюда сам владелец (2026-09-21: «архив
//     засунь в Кабинет»);
//   • ЭТОТ ТЕЛЕФОН — уведомления, язык (владелец 03.10: «в кабинете добавь
//     новую страницу языки») и синхронизация;
//   • АККАУНТ — вход и безопасность, «Помощь», «О приложении» (там же версия, поэтому
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
import { CompaniesSection } from "@/features/cabinet/CompaniesSection";
import { InvitedAccounts } from "@/features/cabinet/InvitedAccounts";
import { OwnAccountSection } from "@/features/cabinet/OwnAccountSection";
import { HelpRow } from "@/features/cabinet/HelpRow";
import { LanguageRow } from "@/features/cabinet/LanguageRow";
import { NotificationsRow } from "@/features/cabinet/NotificationsRow";
import { PersonCard } from "@/features/cabinet/PersonCard";
import { useCurrentRole } from "@/features/settings/tenant";
import { confirmAndSignOut } from "@/lib/auth-clear";
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

        {/* АККАУНТЫ, КОТОРЫЕ ПРИГЛАСИЛИ (04.10): по блоку на каждый — его
            команды и то, что он открыл правами «Кабинета». */}
        <InvitedAccounts />

        {/* СВОЙ АККАУНТ — ВСЕГДА (владелец 04.10): какой бы аккаунт ни был
            открыт на телефоне, тариф, SMS, партнёры и остальное хозяйство —
            за свой (`OwnAccountSection`). */}
        <OwnAccountSection />

        <SectionEyebrow>Этот телефон</SectionEyebrow>
        <SectionCard>
          <NotificationsRow />
          <Divider inset={48} />
          <LanguageRow />
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
          {/* ПОМОЩЬ (владелец 03.10) — частые вопросы и связь с поддержкой. */}
          <HelpRow />
          <Divider inset={48} />
          <AboutRow />
        </SectionCard>

        {/* ВЫХОД — ОДИН НА ПРИЛОЖЕНИЕ И ТОЛЬКО С ЭТОГО УСТРОЙСТВА
            (`confirmAndSignOut` → `scope: "local"`, всегда с вопросом —
            стираются напоминания этого телефона). Выход со всех устройств —
            явной строкой в «Вход и безопасность». */}
        <SectionCard className="mt-4">
          <ActionRow
            label="Выйти из аккаунта"
            tone="danger"
            onPress={() => void confirmAndSignOut()}
          />
        </SectionCard>
      </ScrollView>
    </Screen>
  );
}
