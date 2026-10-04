import { useEffect, useRef, useState } from "react";
import { AppState, ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { History } from "lucide-react-native";
import { Divider } from "@/components/ui/Divider";
import { EmptyState } from "@/components/ui/EmptyState";
import { GradientButton } from "@/components/ui/GradientButton";
import { NoticeBar } from "@/components/ui/NoticeBar";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { GUTTER } from "@/components/ui/tokens";
import { useToast } from "@/components/ui/Toast";
import { useTeams } from "@/features/reference/queries";
import { useAccountGate, useAccountName, useAccountProfile, useAccountScope } from "@/features/cabinet/account-scope";
import { tierAllows, tierOf } from "@/features/tariffs/tiers";
import { useTariffNudge } from "@/features/tariffs/use-tariff";
import { notify } from "@/lib/notify";
import { openSmsCheckout, useSmsAccount, useSmsHistory, type SmsHistoryItem } from "./sms-account";
import { balanceWarning } from "./sms-model";
import { SmsHistoryRow } from "./SmsHistoryRow";
import { SmsMessageSheet } from "./SmsMessageSheet";
import { SmsBalanceCard, SmsTariffCard } from "./SmsParts";
import { SmsTopupSheet } from "./SmsTopupSheet";
import { tDynamic } from "@babun/shared/i18n/runtime";

// КАБИНЕТ → SMS — ДЕНЬГИ И ОТПРАВКА ВСЕЙ КОМПАНИИ (STORY-089; владелец
// 29.09: «баланс и пополнение — это всё будет Кабинет SMS», «баланс единый,
// независимо от команды»; 30.09: «переделать в нашем стиле, календари нашей
// компании… правильные тарифы… кнопка пополнить баланс»).
//
// Сверху вниз, название — в шапке карточки (канон блоков):
//   • БАЛАНС — сумма крупно, «≈ N SMS», месяц в деньгах и штуках;
//   • ТАРИФ — лимиты по длине (1, 2, 3 SMS) и что дают пакеты;
//   • ИСТОРИЯ — последние сообщения и дверь ко всем; календари — там
//     выбором (владелец 30.09: «календари запихни в всю историю»).
// Выключателей отправки нет: команда отправляет, когда у неё есть имя
// отправителя и хватает баланса.
//
// ПОПОЛНЕНИЕ — ОТДЕЛЬНОЙ СТРАНИЦЕЙ ОПЛАТЫ STRIPE, НЕ ЧЕРЕЗ APPLE (владелец
// 30.09 отменил своё «в приложении ни кнопки» от 24.09: «кнопка должна вести
// на пополнение через отдельную страницу… просто и легко для клиента»).
// Внизу «Пополнить баланс» → сумма → страница Stripe; в приложении она
// открывается в браузере, а по возвращении экран сам перечитывает баланс.
//
// БАЛАНС АККАУНТА, КОТОРЫЙ ПРИГЛАСИЛ (04.10): из блока аккаунта в Кабинете
// страница открыта партнёру с правом «SMS» — шапка и кнопка называют
// аккаунт («Пополнить баланс Giliuta»), платят за него. «Видит» — баланс и
// месяц; «Пополняет» — ещё и кнопка. Истории сообщений (переписки с
// клиентами) партнёру здесь нет.

export function SmsScreen() {
  const router = useRouter();
  const toast = useToast();
  const scope = useAccountScope();
  const ownerOfAccount = scope.viewRole === "owner";
  const gate = useAccountGate("cabinet.sms");
  const accountName = useAccountName();
  // Без тарифа SMS нет (02.10) — и пополнять нечего: кнопка серая. Тариф —
  // аккаунта страницы.
  const smsInPlan = tierAllows(tierOf(useAccountProfile().data), "sms");
  const nudgeTariff = useTariffNudge();
  const params = useLocalSearchParams<{ topup?: string }>();
  const account = useSmsAccount();
  const history = useSmsHistory(5);
  const [topupOpen, setTopupOpen] = useState(false);
  // Тап по строке истории — тот же лист сообщения, что в записи и у клиента
  // (владелец 03.10: «такую же шторку — везде»).
  const [open, setOpen] = useState<SmsHistoryItem | null>(null);
  const { data: teams = [] } = useTeams();
  const awaitingPayment = useRef(false);

  // Возврат с оплаты на сайте: Stripe привёл обратно — баланс пересчитает
  // вебхук через секунды, страница перечитывает его.
  useEffect(() => {
    if (params.topup === "paid") {
      toast("Оплата прошла — баланс обновится через минуту", "success");
      const timer = setTimeout(() => void account.refetch(), 4000);
      return () => clearTimeout(timer);
    }
    if (params.topup === "cancelled") toast("Оплата отменена", "info");
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.topup]);

  // В приложении оплата — в браузере: вернулись в приложение — перечитать
  // баланс (вебхук Stripe зачисляет за секунды).
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active" || !awaitingPayment.current) return;
      awaitingPayment.current = false;
      toast("Проверяем оплату…", "info");
      setTimeout(() => void account.refetch(), 2500);
      setTimeout(() => void account.refetch(), 9000);
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const data = account.data;
  const owner = data?.owner;

  const topup = async (cents: number) => {
    setTopupOpen(false);
    try {
      awaitingPayment.current = true;
      await openSmsCheckout(cents, undefined, scope.foreign ? scope.tenantId : null);
    } catch (e) {
      awaitingPayment.current = false;
      notify("Оплата не открылась", e instanceof Error ? e.message : undefined);
    }
  };

  const subtitle = !ownerOfAccount || scope.foreign ? (accountName ?? undefined) : undefined;
  const canTopUp = ownerOfAccount || gate === "write";

  // Без права «SMS» страница пуста — сюда ведёт только старая ссылка.
  if (!ownerOfAccount && gate !== "read" && gate !== "write") {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="SMS" subtitle={subtitle} />
        <EmptyState fill state={gate === "loading" ? "loading" : undefined} title={gate === "loading" ? undefined : "SMS скрыты"} />
      </Screen>
    );
  }

  if (account.isLoading) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="SMS" subtitle={subtitle} />
        <EmptyState state="loading" fill />
      </Screen>
    );
  }
  if (account.isError || !data || !owner) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="SMS" subtitle={subtitle} />
        <EmptyState
          state="error"
          fill
          subtitle={account.error instanceof Error ? account.error.message : undefined}
          action={{ label: "Повторить", onPress: () => void account.refetch() }}
        />
      </Screen>
    );
  }

  const warning = balanceWarning(data);

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="SMS" subtitle={subtitle} />
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 24 }}>
        {/* Плашки нет (владелец 30.09: «баланс ноль и так видно»): «Пополните
            баланс» — строкой под суммой. Плашка — только заморозка сверкой. */}
        {!data.serviceOn ? (
          <View style={{ marginHorizontal: GUTTER, marginTop: 12 }}>
            <NoticeBar tone="info" message="Сервис SMS ещё не подключён" />
          </View>
        ) : data.frozen && warning ? (
          <View style={{ marginHorizontal: GUTTER, marginTop: 12 }}>
            <NoticeBar tone="error" message={warning} />
          </View>
        ) : null}
        {/* ТРЕВОГИ СВЕРКИ (волна 13): расхождение журнала, спор по карте,
            предохранитель платформы. Администратору платформы — и чужие. */}
        {(owner.alerts ?? []).slice(0, 3).map((alert) => (
          <View key={`${alert.kind}-${alert.at}`} style={{ marginHorizontal: GUTTER, marginTop: 12 }}>
            <NoticeBar tone="error" message={alert.own ? tDynamic(alert.message) : `Платформа: ${tDynamic(alert.message)}`} />
          </View>
        ))}

        <SmsBalanceCard account={data} />

        <SmsTariffCard priceCents={data.priceCents} />

        {/* Переписка с клиентами — владельцу аккаунта (04.10). */}
        {ownerOfAccount ? (
          <SectionCard title="История">
            {(history.data ?? []).map((item, index) => (
              <View key={item.id}>
                {index > 0 ? <Divider inset={16} /> : null}
                <SmsHistoryRow item={item} compact onPress={() => setOpen(item)} />
              </View>
            ))}
            {/* «Вся история» читает аккаунт, открытый на телефоне: свой
                аккаунт, открытый из Кабинета со стороны (04.10), показывает
                последние сообщения без двери. */}
            {scope.foreign ? null : (
              <>
                {(history.data ?? []).length > 0 ? <Divider inset={48} /> : null}
                <SettingsRow
                  tile="neutral"
                  icon={History}
                  title="Вся история"
                  sub={(history.data ?? []).length > 0 ? undefined : "Сообщений пока нет"}
                  onPress={() => router.push("/cabinet/sms-history" as Href)}
                />
              </>
            )}
          </SectionCard>
        ) : null}
      </ScrollView>

      {/* ГЛАВНОЕ ДЕЙСТВИЕ — ВНИЗУ: пополнить баланс. */}
      {data.serviceOn && canTopUp ? (
        <View style={{ paddingHorizontal: GUTTER, paddingTop: 8, paddingBottom: 16 }}>
          <GradientButton
            label={subtitle ? `Пополнить баланс ${subtitle}` : "Пополнить баланс"}
            disabled={!smsInPlan}
            onDisabledPress={nudgeTariff}
            onPress={() => setTopupOpen(true)}
          />
        </View>
      ) : null}

      <SmsTopupSheet
        visible={topupOpen}
        priceCents={data.priceCents}
        onClose={() => setTopupOpen(false)}
        onPay={(cents) => void topup(cents)}
      />
      <SmsMessageSheet
        item={open}
        teamName={(teamId) => teams.find((x) => x.id === teamId)?.name ?? null}
        onClose={() => setOpen(null)}
      />
    </Screen>
  );
}

export default SmsScreen;
