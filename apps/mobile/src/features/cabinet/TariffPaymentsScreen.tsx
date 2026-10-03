import { Fragment, useMemo, useRef } from "react";
import { Linking, RefreshControl, ScrollView } from "react-native";
import { CircleAlert, CreditCard, Receipt } from "lucide-react-native";

import { Divider } from "@/components/ui/Divider";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { useDataRole } from "@/features/settings/tenant";
import { openTariffPortal, useTariff } from "@/features/tariffs/use-tariff";
import { loadErrorWords } from "@/lib/connection-words";
import { notify } from "@/lib/notify";
import { usePullRefresh } from "@/lib/pull-refresh";
import { useThemeColors } from "@/theme/colors";

import { groupByMonth, paymentSub, paymentValue, type TariffPayment } from "./tariff-payments";
import { useTariffPayments } from "./use-tariff-payments";

// «ОПЛАТЫ ТАРИФА» (Кабинет, владелец 03.10: «оплаты тарифа — да, надо»).
// История списаний за подписку: события Stripe из `billing_events`, по
// месяцам. Строка — тариф, срок, сумма; не прошедшая оплата красная и
// подписана «не прошла». Тап по строке открывает чек Stripe (нет чека — pdf
// счёта) в браузере.
//
// Сверху — «Управлять подпиской»: страница Stripe с картой и отменой. Она
// стоит и при пустой истории: подписка могла оформиться раньше, чем вебхук
// начал записывать события, и тогда управлять ей всё равно нужно.
//
// Видит только владелец аккаунта (политика таблицы): остальным — слова.

// Вшитый отступ разделителя нейтральной строки: поле 16 + глиф 20 + зазор 12.
const NEUTRAL_ROW_INSET = 48;

/** Чек — в браузере; на вебе это новая вкладка, CRM остаётся открытой. */
async function openReceipt(url: string): Promise<void> {
  try {
    await Linking.openURL(url);
  } catch {
    notify("Чек не открылся", "Попробуйте ещё раз.");
  }
}

export function TariffPaymentsScreen() {
  const t = useThemeColors();
  const role = useDataRole();
  const payments = useTariffPayments();
  const pull = usePullRefresh(payments.refetch);
  const opening = useRef(false);
  const months = useMemo(() => groupByMonth(payments.data ?? []), [payments.data]);
  // ВЫДАН НАВСЕГДА И НИ ОДНОЙ ОПЛАТЫ — ПОДПИСКИ В STRIPE НЕТ (проверка 03.10):
  // строка вела в портал, которого у аккаунта не существует, и отвечала
  // «Подписка не открылась». Страница «Тариф» по той же причине прячет
  // кнопки. Была история — подписка была, дверь остаётся.
  // Дверь в Stripe — только к подписке, которая есть: оплаченной или с
  // оплатами в истории. На пробном и без тарифа строка вела в «Подписки ещё
  // нет — сначала оплатите тариф» (аудит Кабинета 03.10); у «навсегда»
  // подписки нет вовсе.
  const tariffState = useTariff().state;
  const hasSubscription = tariffState.paid && !tariffState.forever;
  const now = Date.now();

  const manage = async () => {
    if (opening.current) return;
    opening.current = true;
    try {
      await openTariffPortal();
    } catch (e) {
      notify("Подписка не открылась", e instanceof Error ? e.message : undefined);
    } finally {
      opening.current = false;
    }
  };

  const renderRow = (payment: TariffPayment) => {
    const { url } = payment;
    return (
      <SettingsRow
        tile="neutral"
        icon={payment.failed ? CircleAlert : Receipt}
        title={payment.title}
        sub={paymentSub(payment, now)}
        value={paymentValue(payment)}
        valueColor={payment.failed ? t.danger : undefined}
        onPress={url ? () => void openReceipt(url) : undefined}
      />
    );
  };

  const renderBody = () => {
    if (role.isPending) return <EmptyState state="loading" fill />;
    if (role.isError) {
      const words = loadErrorWords(role.error, {
        failed: "Не удалось проверить доступ",
        later: "Оплаты загрузятся, как только сервер ответит.",
      });
      return (
        <EmptyState
          state="error"
          fill
          title={words.title}
          subtitle={words.subtitle}
          action={{ label: "Повторить", onPress: () => void role.refetch() }}
        />
      );
    }
    if (role.data !== "owner") return <EmptyState fill title="Оплаты видит владелец аккаунта" />;
    if (payments.isPending) return <EmptyState state="loading" fill />;
    if (payments.isError) {
      const words = loadErrorWords(payments.error, {
        failed: "Не удалось загрузить оплаты",
        later: "Оплаты загрузятся, как только сервер ответит.",
      });
      return (
        <EmptyState
          state="error"
          fill
          title={words.title}
          subtitle={words.subtitle}
          action={{ label: "Повторить", onPress: () => void payments.refetch() }}
        />
      );
    }
    return (
      <ScrollView
        contentContainerStyle={{ paddingBottom: 32, flexGrow: 1 }}
        refreshControl={
          <RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} tintColor={t.accent} />
        }
      >
        {!hasSubscription && months.length === 0 ? null : (
          <SectionCard>
            <SettingsRow
              tile={SETTINGS_TILE.blue}
              icon={CreditCard}
              title="Управлять подпиской"
              sub="Карта, отмена"
              onPress={() => void manage()}
            />
          </SectionCard>
        )}
        {months.length === 0 ? (
          <EmptyState fill title="Оплат пока не было" />
        ) : (
          months.map((month) => (
            <SectionCard key={month.key} title={month.title}>
              {month.payments.map((payment, index) => (
                <Fragment key={payment.id}>
                  {index > 0 ? <Divider inset={NEUTRAL_ROW_INSET} /> : null}
                  {renderRow(payment)}
                </Fragment>
              ))}
            </SectionCard>
          ))
        )}
      </ScrollView>
    );
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Оплаты тарифа" />
      {renderBody()}
    </Screen>
  );
}

export default TariffPaymentsScreen;
