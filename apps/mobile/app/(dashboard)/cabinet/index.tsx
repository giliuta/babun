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
//   • КОМАНДЫ (не «Компания»: у владельца нет компаний, есть аккаунт и его
//     команды — 01.10; «Аккаунт» — уже имя секции входа ниже) — «Тариф», «Оплаты тарифа», «Партнёры», «История изменений»,
//     «Реквизиты» (03.10, из шестерёнки «Финансов»: «единый блок на все
//     компании»), «SMS», «Выгрузка данных» и «Архив» (только владельцу;
//     «Реквизиты» видит и партнёр с их правом). История — кто что
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
import { RefreshCw, Shield, Users } from "lucide-react-native";
import { useQueueDepth } from "@babun/shared/sync";
import { ActionRow } from "@/components/ui/card-rows";
import { Divider } from "@/components/ui/Divider";
import { Screen } from "@/components/ui/Screen";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { TYPE } from "@/components/ui/tokens";
import { AboutRow } from "@/features/cabinet/AboutRow";
import { ArchiveRow } from "@/features/cabinet/ArchiveRow";
import { CabinetRequisitesRow } from "@/features/cabinet/CabinetRequisitesRow";
import { CompaniesSection } from "@/features/cabinet/CompaniesSection";
import { HistoryRow } from "@/features/cabinet/HistoryRow";
import { DataExportRow } from "@/features/cabinet/DataExportRow";
import { HelpRow } from "@/features/cabinet/HelpRow";
import { LanguageRow } from "@/features/cabinet/LanguageRow";
import { TariffPaymentsRow } from "@/features/cabinet/TariffPaymentsRow";
import { NotificationsRow } from "@/features/cabinet/NotificationsRow";
import { SmsCabinetRow } from "@/features/sms/SmsCabinetRow";
import { PersonCard } from "@/features/cabinet/PersonCard";
import { TariffRow } from "@/features/tariffs/TariffRow";
import { useCurrentRole } from "@/features/settings/tenant";
import { useFinanceSettingLevel } from "@/features/finances/use-finance-settings";
import { confirmAndSignOut } from "@/lib/auth-clear";
import { useThemeColors } from "@/theme/colors";

export default function CabinetHome() {
  const t = useThemeColors();
  const router = useRouter();
  const { data: role } = useCurrentRole();
  const syncDepth = useQueueDepth();
  // Очередь выгрузки видят те, кто правит данные офлайн, — как и прежде.
  const showSync = role === "owner" || role === "dispatcher";
  // Партнёр с «Реквизиты: Только видит» открывает их тоже отсюда.
  const requisitesLevel = useFinanceSettingLevel("requisites", null);
  const partnerRequisites = role !== "owner" && requisitesLevel !== "hidden";

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
            <SectionEyebrow>Команды</SectionEyebrow>
            <SectionCard>
              {/* СОТРУДНИКИ — ОДИН СПИСОК НА КОМПАНИЮ (владелец 29.09: «страницу
                  мастера перенесём в кабинет… и полноценно на каждую команду,
                  что он может делать»). Прежде люди жили в настройках каждого
                  календаря. Приглашает и ставит права только владелец. */}
              {/* ТАРИФ — ПЕРВЫМ (владелец 01.10: «выбор тарифа — в кабинете»).
                  Страницы тариф не закрывает (владелец 02.10: «всё
                  открывается, блокируются только кнопки»): «Партнёры»
                  открыты всегда, серая там только «Пригласить партнёра». */}
              <TariffRow />
              <Divider inset={48} />
              {/* ОПЛАТЫ ТАРИФА (владелец 03.10) — платежи за подписку и чеки. */}
              <TariffPaymentsRow />
              <Divider inset={48} />
              <SettingsRow
                tile={SETTINGS_TILE.indigo}
                icon={Users}
                title="Партнёры"
                sub="Права по командам"
                onPress={() => router.push("/cabinet/people" as Href)}
              />
              <Divider inset={48} />
              {/* РЕКВИЗИТЫ (владелец 03.10: «единый блок на все компании —
                  запихни в кабинет»), прежде — шестерёнка «Финансов». */}
              <CabinetRequisitesRow />
              <Divider inset={48} />
              {/* ИСТОРИЯ ИЗМЕНЕНИЙ (владелец 03.10): кто что менял во всех
                  календарях — он сам и каждый партнёр. */}
              <HistoryRow />
              <Divider inset={48} />
              <SmsCabinetRow />
              <Divider inset={48} />
              {/* ВЫГРУЗКА ДАННЫХ (владелец 03.10: «только из своих личных
                  команд») — клиенты, записи и финансы своего аккаунта. */}
              <DataExportRow />
              <Divider inset={48} />
              <ArchiveRow />
            </SectionCard>
          </>
        ) : partnerRequisites ? (
          <>
            <SectionEyebrow>Команды</SectionEyebrow>
            <SectionCard>
              <CabinetRequisitesRow />
            </SectionCard>
          </>
        ) : null}

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
