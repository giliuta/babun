import { useEffect, useState } from "react";
import { AppState, ScrollView, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Check, CreditCard, Receipt } from "lucide-react-native";
import { Divider } from "@/components/ui/Divider";
import { EmptyState } from "@/components/ui/EmptyState";
import { GradientButton } from "@/components/ui/GradientButton";
import { PageFooter } from "@/components/ui/PageFooter";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { useToast } from "@/components/ui/Toast";
import { GUTTER, TYPE, SETTINGS_ROW_INSET } from "@/components/ui/tokens";
import { useAccountGate, useAccountName, useAccountScope } from "@/session/account-scope";
import { notify } from "@/lib/notify";
import { CAN_PAY_HERE } from "@/lib/pay-here";
import { useThemeColors } from "@/theme/colors";
import {
  CALENDAR_CARD,
  partnerTariffAction,
  tariffAction,
  tariffStatus,
  type BillingPeriod,
  type TariffState,
} from "@/session/tiers";
import { openTariffCheckout, openTariffPortal, useCalendarTariff, useStartTrial } from "./use-tariff";
import { usePageCalendar } from "./use-page-calendar";

// ТАРИФ КАЛЕНДАРЯ — €9,99 в месяц, €7,99 в месяц при оплате за год; люди
// бесплатно. Сюда ведёт строка «Тариф» в шестерёнке календаря: у каждого
// календаря своя подписка, один можно оплатить, а другой нет. Пробный 14
// дней без карты — один раз на аккаунт и сразу на все его календари; оплата
// — страница Stripe в браузере.
//
// Сверху — что действует у этого календаря; под ним «Управление подпиской»
// (страница Stripe: карта, счета, отмена — общая на все календари аккаунта)
// и «Оплаты» этого календаря. Ниже — цена; действие страницы одно, в футере:
// «Попробовать 14 дней», «Оплатить €… в месяц» («… за год» —
// переключатель «Месяц · Год») или, у оплаченного, переход на другой период.
//
// Тариф после оплаты приходит вебхуком Stripe: вернулся из браузера —
// тариф перечитывается.
//
// ПАРТНЁР видит страницу по праву «Тариф»: «Видит» — только что действует;
// «Оплачивает» — кнопка «Оплатить … за <аккаунт>», пока подписки нет.
// Пробный, смена периода и управление подпиской — у владельца.
//
// В ПРИЛОЖЕНИИ ИЗ МАГАЗИНА БЕЗ ОПЛАТЫ (`CAN_PAY_HERE` выключен, `pay-here.ts`)
// — строка состояния и только кнопка пробного: он бесплатный, это не
// покупка. Цена и оплата — на babun.app.

export function TariffScreen() {
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { team, loading: teamLoading } = usePageCalendar();
  const { state, periodEnd, loading } = useCalendarTariff(team?.id);
  const scope = useAccountScope();
  const owner = scope.viewRole === "owner";
  const gate = useAccountGate("cabinet.tariff");
  const paymentsGate = useAccountGate("cabinet.tariff_payments");
  const accountName = useAccountName();
  const startTrial = useStartTrial();
  const [paying, setPaying] = useState(false);
  // Выбор человека; пока не выбирал — период живой подписки (или месяц).
  const [picked, setPicked] = useState<BillingPeriod | null>(null);
  const period = picked ?? state.period ?? "month";

  // Вернулся из браузера (оплата, управление подпиской) — перечитать тариф.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") void qc.invalidateQueries({ queryKey: ["tenant"] });
    });
    return () => sub.remove();
  }, [qc]);

  const full = owner
    ? tariffAction(state, period)
    : gate === "write"
      ? partnerTariffAction(state, accountName, period)
      : null;
  // Без оплаты здесь — только бесплатный пробный.
  const action = CAN_PAY_HERE ? full : full?.kind === "trial" ? full : null;

  const run = async () => {
    if (!action || !team) return;
    if (action.kind === "trial") {
      try {
        await startTrial.mutateAsync("max");
        toast("Пробный — 14 дней", "success");
      } catch (e) {
        notify("Пробный не включился", e instanceof Error ? e.message : undefined);
      }
      return;
    }
    setPaying(true);
    try {
      const result = await openTariffCheckout({ teamId: team.id, period });
      if (result === "changed") {
        toast("Оплата календаря обновлена", "success");
        // Тариф пишет вебхук Stripe — через пару секунд.
        void qc.invalidateQueries({ queryKey: ["tenant"] });
        setTimeout(() => void qc.invalidateQueries({ queryKey: ["tenant"] }), 4000);
      }
    } catch (e) {
      notify(action.kind === "change" ? "Оплата не сменилась" : "Оплата не открылась", e instanceof Error ? e.message : undefined);
    } finally {
      setPaying(false);
    }
  };

  const manage = async () => {
    setPaying(true);
    try {
      await openTariffPortal(null, team?.id);
    } catch (e) {
      notify("Подписка не открылась", e instanceof Error ? e.message : undefined);
    } finally {
      setPaying(false);
    }
  };

  // Без права «Тариф» страница пуста — сюда ведёт только старая ссылка.
  if (!owner && gate !== "read" && gate !== "write") {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Тариф" subtitle={accountName ?? undefined} />
        <EmptyState
          fill
          state={gate === "loading" ? "loading" : undefined}
          title={gate === "loading" ? undefined : "Тариф скрыт"}
        />
      </Screen>
    );
  }

  if (!team) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Тариф" />
        <EmptyState fill state={teamLoading ? "loading" : undefined} title={teamLoading ? undefined : "Календарей пока нет"} />
      </Screen>
    );
  }

  const showPeriod =
    CAN_PAY_HERE && ((action != null && action.kind !== "trial") || (owner && state.paid && !!state.period));
  // Оплаты — у оплаченного: у календаря без подписки дверь вела бы в пустую
  // страницу.
  const seesPayments = CAN_PAY_HERE && state.paid && (owner || paymentsGate === "read" || paymentsGate === "write");

  return (
    <Screen edges={["top"]}>
      {/* Чужой аккаунт — его имя в шапке: платят за него, а не за свой. */}
      <ScreenHeader title="Тариф" subtitle={owner ? undefined : (accountName ?? undefined)} />
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 24 }}>
        <SectionCard>
          {/* Плитка — цвет календаря: страница узнаётся тем же пятном, что
              его чип и строка в шестерёнке. */}
          <SettingsRow
            appearance={{ color: team.color }}
            title={team.name}
            sub={loading ? undefined : tariffStatus(state, periodEnd, CAN_PAY_HERE)}
          />
          {CAN_PAY_HERE && owner && state.paid ? (
            <>
              <Divider inset={SETTINGS_ROW_INSET} />
              <SettingsRow
                tile={SETTINGS_TILE.green}
                icon={CreditCard}
                title="Управление подпиской"
                sub="Карта, счета, отмена"
                onPress={paying ? undefined : () => void manage()}
              />
            </>
          ) : null}
          {seesPayments ? (
            <>
              <Divider inset={SETTINGS_ROW_INSET} />
              <SettingsRow
                tile={SETTINGS_TILE.blue}
                icon={Receipt}
                title="Оплаты"
                sub="Чеки этого календаря"
                onPress={() => router.push(`/calendar/tariff-payments?team=${encodeURIComponent(team.id)}` as Href)}
              />
            </>
          ) : null}
        </SectionCard>

        {CAN_PAY_HERE ? (
          <>
            <SectionEyebrow>Цена</SectionEyebrow>
            <PriceCard state={state} />
          </>
        ) : null}
        {/* Период — только у оплаты: пробный бесплатный, а у выданного
            навсегда кнопки нет. У оплаченного он стоит на своём, и выбор
            другого даёт кнопку перехода. */}
        {showPeriod ? (
          <SegmentedControl
            options={PERIOD_OPTIONS}
            value={period}
            onChange={setPicked}
            style={{ marginHorizontal: GUTTER, marginTop: 12 }}
          />
        ) : null}
      </ScrollView>

      {action ? (
        <PageFooter>
          <GradientButton
            label={action.label}
            loading={startTrial.isPending || paying}
            onPress={() => void run()}
          />
        </PageFooter>
      ) : null}
    </Screen>
  );
}

const PERIOD_OPTIONS = [
  { value: "month", label: "Месяц" },
  { value: "year", label: "Год" },
] as const satisfies readonly { value: BillingPeriod; label: string }[];

/** Метка у имени цены — что у календаря сейчас. */
function priceMark(state: TariffState): string | null {
  if (state.forever) return "Навсегда";
  if (state.paid) return "Оплачен";
  if (state.trial) return "Пробный";
  return null;
}

function PriceCard({ state }: { state: TariffState }) {
  const t = useThemeColors();
  const card = CALENDAR_CARD;
  const mark = priceMark(state);
  // Выданному навсегда цены не печатаем вовсе: ни за месяц, ни за год —
  // это не его счёт.
  const priced = !state.forever;
  return (
    <View
      accessible
      accessibilityLabel={priced ? `${card.name}, ${card.monthly} в месяц` : card.name}
      style={{
        marginHorizontal: GUTTER,
        marginTop: 8,
        borderRadius: t.radius.card,
        borderCurve: "continuous",
        backgroundColor: t.surface,
        boxShadow: t.cardShadow,
        paddingHorizontal: 16,
        paddingVertical: 14,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
        <Text style={{ ...TYPE.headline, color: t.ink }}>{card.name}</Text>
        {mark ? <Text style={{ ...TYPE.subhead, color: t.accent }}>{mark}</Text> : null}
        <View style={{ flex: 1 }} />
        {priced ? (
          <>
            <Text style={{ ...TYPE.headline, color: t.ink, fontVariant: ["tabular-nums"] }}>{card.monthly}</Text>
            <Text style={{ ...TYPE.subhead, color: t.faint }}>в месяц</Text>
          </>
        ) : null}
      </View>
      <View style={{ gap: 6 }}>
        {card.includes.map((line) => (
          <View key={line} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Check size={14} color={t.accent} strokeWidth={2.4} />
            <Text style={{ ...TYPE.body, color: t.sub }}>{line}</Text>
          </View>
        ))}
      </View>
      {priced ? (
        <Text style={{ ...TYPE.subhead, color: t.faint }}>{`За год — ${card.yearlyMonthly} в месяц`}</Text>
      ) : null}
    </View>
  );
}

export default TariffScreen;
