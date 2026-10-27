// Кабинет — ЛИЧНОЕ ПРОСТРАНСТВО ЧЕЛОВЕКА во всей системе (не компании,
// а личное).
//
// НАСТРОЕК РАЗДЕЛОВ ЗДЕСЬ НЕТ: все настройки там, где открывают шестерёнку,
// в кабинете их не дублируем. Календарь, клиенты и
// финансы настраиваются за шестерёнкой своего раздела.
//
// Состав — то, что принадлежит человеку и этому телефону, и у каждой строки
// подпись с живым состоянием, а не пояснение:
//   • карта человека → «Профиль»;
//   • ПРИГЛАШЕНИЯ и под ними — БЛОК КАЖДОГО АККАУНТА, КОТОРЫЙ ПРИГЛАСИЛ:
//     шапка — его имя, строки — его команды и то, что он
//     открыл правами «Кабинета» (тариф, оплаты, SMS, реквизиты); страницы
//     открываются и платят за этот аккаунт (`InvitedAccounts`);
//   • КОМАНДЫ (не «Компания»: у владельца нет компаний, есть аккаунт и его
//     команды; «Аккаунт» — уже имя секции входа ниже) — «Тариф», «Оплаты
//     тарифа», «Партнёры», «История изменений», «Реквизиты» (единый блок на
//     все команды), «SMS», «Выгрузка данных» и «Архив» — всегда за СВОЙ
//     аккаунт, какой бы ни был открыт на телефоне (`OwnAccountSection`);
//     реквизиты пригласившего — в его блоке выше. История — кто что
//     менял во всех календарях; выгрузка — только своих команд. SMS — баланс,
//     пополнение и отправка всей компании; шаблоны команд — за
//     шестерёнкой календаря. Архив — удалённые календари, откуда их
//     возвращают или стирают навсегда. Это не настройки раздела, а деньги и
//     место хранения;
//   • ЭТОТ ТЕЛЕФОН — уведомления, язык и синхронизация;
//   • АККАУНТ — вход и безопасность, «Помощь», «О приложении» (там же версия, поэтому
//     отдельной подписи версии внизу нет);
//   • выход только с этого устройства.
// Новую настройку раздела сюда не добавлять — её место за шестерёнкой.

import { useCallback, useRef } from "react";
import { ScrollView, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { RefreshCw, Shield } from "lucide-react-native";
import { useQueueDepth } from "@babun/shared/sync";
import type { QueuedOp } from "@babun/shared/db/cache/sql";
import { isQueuedOpVisibleForTenant } from "@/lib/sync-queue-policy";
import { useMemberQueue } from "@/lib/member-queue/use-member-queue";
import { useTenantId } from "@/lib/tenant";
import { ActionRow } from "@/components/ui/card-rows";
import { Divider } from "@/components/ui/Divider";
import { Screen } from "@/components/ui/Screen";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { TYPE } from "@/components/ui/tokens";
import { TourScrollProvider, TourTarget } from "@/components/tour/TourTarget";
import { AboutRow } from "@/features/cabinet/AboutRow";
import { CompaniesSection } from "@/features/cabinet/CompaniesSection";
import { InvitedAccounts } from "@/features/cabinet/InvitedAccounts";
import { OwnAccountSection } from "@/features/cabinet/OwnAccountSection";
import { HelpRow } from "@/features/cabinet/HelpRow";
import { LanguageRow } from "@/features/cabinet/LanguageRow";
import { NotificationsRow } from "@/features/cabinet/NotificationsRow";
import { PersonCard } from "@/features/cabinet/PersonCard";
import { useCurrentRole } from "@/session/tenant";
import { confirmAndSignOut } from "@/lib/auth-clear";
import { useThemeColors } from "@/theme/colors";

export default function CabinetHome() {
  const t = useThemeColors();
  const router = useRouter();
  const { data: role } = useCurrentRole();
  // Цифра — тем же фильтром компании, что список на экране «Синхронизация»:
  // очередь одна на телефон, а за тапом видны только операции открытой
  // компании.
  const tenantId = useTenantId();
  const visibleOp = useCallback(
    (op: QueuedOp) => isQueuedOpVisibleForTenant(op, tenantId),
    [tenantId],
  );
  // Правки сотрудника без сети — своя очередь (`lib/member-queue`), та же строка.
  const syncDepth = useQueueDepth(visibleOp) + useMemberQueue(tenantId).length;
  // Очередь выгрузки видят все, кто правит без сети: владелец — правки
  // таблиц, сотрудник — отложенные вызовы дверей сервера.
  const showSync = role === "owner" || role === "dispatcher" || role === "master";
  // Прокрутка — для обучения: строки внизу оно докручивает на вид.
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);

  return (
    // Низ закрывает таб-бар — как у «Клиентов» и «Финансов». Со всеми краями
    // над таб-баром висела пустая полоса навигации (на Android с кнопками —
    // 48 dp), и последний пункт списка обрезался над ней.
    <Screen edges={["top"]}>
      <View className="px-4 pb-1 pt-4">
        <Text style={{ ...TYPE.display, color: t.ink }}>Кабинет</Text>
      </View>

      <TourScrollProvider scrollRef={scrollRef} scrollY={scrollY}>
      <ScrollView
        ref={scrollRef}
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 24 }}
        scrollEventThrottle={16}
        onScroll={(e) => {
          scrollY.current = e.nativeEvent.contentOffset.y;
        }}
      >
        <PersonCard tourId="cabinet.profile" onPress={() => router.push("/cabinet/profile" as Href)} />

        <CompaniesSection />

        {/* АККАУНТЫ, КОТОРЫЕ ПРИГЛАСИЛИ: по блоку на каждый — его
            команды и то, что он открыл правами «Кабинета». */}
        <InvitedAccounts />

        {/* СВОЙ АККАУНТ — ВСЕГДА: какой бы аккаунт ни был
            открыт на телефоне, тариф, SMS, партнёры и остальное хозяйство —
            за свой (`OwnAccountSection`). */}
        <OwnAccountSection />

        <SectionEyebrow>Этот телефон</SectionEyebrow>
        <SectionCard>
          <TourTarget id="cabinet.notifications">
            <NotificationsRow />
          </TourTarget>
          <Divider inset={48} />
          <TourTarget id="cabinet.languages">
            <LanguageRow />
          </TourTarget>
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
          <TourTarget id="cabinet.account">
            <SettingsRow
              // Своего пигмента у безопасности в словаре `SETTINGS_TILE` нет:
              // голый глиф, как у «Часового пояса».
              tile="neutral"
              icon={Shield}
              title="Вход и безопасность"
              sub="Пароль, устройства, удаление аккаунта"
              onPress={() => router.push("/cabinet/account")}
            />
          </TourTarget>
          <Divider inset={48} />
          {/* ПОМОЩЬ — частые вопросы и связь с поддержкой. */}
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
      </TourScrollProvider>
    </Screen>
  );
}
