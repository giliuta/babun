import { useEffect, useState } from "react";
import { AppState, Pressable, ScrollView, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Check, CreditCard, Layers } from "lucide-react-native";
import { Divider } from "@/components/ui/Divider";
import { GradientButton } from "@/components/ui/GradientButton";
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
import { EmptyState } from "@/components/ui/EmptyState";
import { useTeams } from "@/features/reference/queries";
import { notify } from "@/lib/notify";
import { CAN_PAY_HERE } from "@/lib/pay-here";
import { useThemeColors } from "@/theme/colors";
import {
  TIER_CARDS,
  calendarsMonthly,
  tiersForKind,
  TIER_LIMITS,
  partnerTariffAction,
  tariffAction,
  tariffStatus,
  tierName,
  workingTeamIds,
  type BillingPeriod,
  type Tier,
  type TierCard,
} from "@/session/tiers";
import { openTariffCheckout, openTariffPortal, useStartTrial, useTariff } from "./use-tariff";
import { useLiveCalendarCount } from "./use-live-calendars";

// КАБИНЕТ → ТАРИФ — ЦЕНА ЗА КАЛЕНДАРЬ (€9,99 в месяц за рабочий календарь,
// €7,99 при оплате за год, люди бесплатно). Пробный 14 дней без карты — один раз; оплата —
// страница Stripe в браузере.
//
// Сверху — что действует сейчас; ниже — карточка «Календарь»: цена одного и
// итог за все живые календари аккаунта; действие страницы одно, в футере:
// «Попробовать 14 дней», «Оплатить €… в месяц» («… за год» — переключатель
// «Месяц · Год» под карточкой) или, когда старая подписка есть, «Перейти на
// цену за календарь». Подписка есть — строка
// «Управление подпиской» (страница Stripe: карта, счета, отмена). Команд
// больше лимита — строка «Рабочие команды» ведёт к выбору, какие работают;
// остальные только смотрят.
//
// Тариф после оплаты приходит вебхуком Stripe: вернулся из браузера —
// профиль перечитывается.
//
// ТАРИФ АККАУНТА, КОТОРЫЙ ПРИГЛАСИЛ: из блока аккаунта в Кабинете
// страница открыта партнёру с правом «Тариф» — шапка называет аккаунт.
// «Видит» — только что действует; «Оплачивает» — кнопка «Оплатить … за
// <аккаунт>», пока подписки нет. Пробный, смена тарифа, рабочие команды и
// управление подпиской — у владельца.
//
// ПРОБНЫЙ — ТОЛЬКО КНОПКОЙ ЗДЕСЬ: автоматически он не включается, ни после
// регистрации, ни при первом входе. Новый аккаунт начинает без тарифа, а
// «Попробовать 14 дней» стоит здесь в любой сборке.
//
// В ПРИЛОЖЕНИИ ИЗ МАГАЗИНА БЕЗ ОПЛАТЫ (`CAN_PAY_HERE` выключен, `pay-here.ts`)
// — строка тарифа со сроком, «Рабочие команды» и только кнопка пробного «Про»:
// он бесплатный, это не покупка. Выбор тарифа и оплата — на babun.app.

export function TariffScreen() {
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { state, periodEnd, workingChosen } = useTariff();
  const scope = useAccountScope();
  const offered = tiersForKind(null);
  const owner = scope.viewRole === "owner";
  const gate = useAccountGate("cabinet.tariff");
  const accountName = useAccountName();
  const { data: teams = [] } = useTeams();
  const liveCount = useLiveCalendarCount();
  const startTrial = useStartTrial();
  const [paying, setPaying] = useState(false);
  const current = state.tier && state.tier !== "free" ? state.tier : null;
  // Выбор человека; пока не выбирал — действующий тариф (профиль может
  // приехать после первого кадра).
  const [picked, setPicked] = useState<Exclude<Tier, "free"> | null>(null);
  const [period, setPeriod] = useState<BillingPeriod>("month");
  // Выдан навсегда — выбирать нечего: выделен свой тариф, а не прошлый тап.
  // Без плиток выбора (сборка без оплаты) пробный — на основной «Про».
  const fallback = offered[0]!;
  const selected = state.forever
    ? (current ?? "max")
    : (picked ?? current ?? fallback);

  // Вернулся из браузера (оплата, управление подпиской) — перечитать тариф.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") void qc.invalidateQueries({ queryKey: ["tenant"] });
    });
    return () => sub.remove();
  }, [qc]);

  const live = teams.filter((team) => team.is_active !== false);
  const limit = state.tier ? TIER_LIMITS[state.tier].teams : live.length;
  // Рабочие команды выбирает владелец — и только своего, открытого аккаунта.
  const overLimit = owner && !scope.foreign && live.length > limit;
  const working = workingTeamIds(live, state.tier, workingChosen);
  // Платят за каждый живой календарь с работой — столько и в кнопке; счёт —
  // по аккаунту страницы, а не по открытому в календаре. Пока число не
  // пришло — минимум подписки, а не все живые: календари только с событиями
  // бесплатны.
  const calendars = Math.max(1, liveCount ?? 0);
  const full = owner
    ? tariffAction(state, selected, calendars, period)
    : gate === "write"
      ? partnerTariffAction(state, selected, accountName, calendars, period)
      : null;
  // Без оплаты здесь — только бесплатный пробный.
  const action = CAN_PAY_HERE ? full : full?.kind === "trial" ? full : null;
  // Выбирать тариф есть смысл тому, кто может за него заплатить.
  const canPick = !state.forever && (owner || gate === "write");
  // Плитки тарифов — только там, где тариф выбирают: на сайте.
  const showTiers = CAN_PAY_HERE;

  const run = async () => {
    if (!action) return;
    if (action.kind === "trial") {
      try {
        await startTrial.mutateAsync(selected);
        toast("Пробный — 14 дней", "success");
      } catch (e) {
        notify("Пробный не включился", e instanceof Error ? e.message : undefined);
      }
      return;
    }
    setPaying(true);
    try {
      const result = await openTariffCheckout(selected, scope.foreign ? scope.tenantId : null, undefined, period);
      if (result === "changed") {
        toast("Оплата за календари обновлена", "success");
        // Тариф пишет вебхук Stripe — через пару секунд.
        void qc.invalidateQueries({ queryKey: ["tenant"] });
        setTimeout(() => void qc.invalidateQueries({ queryKey: ["tenant"] }), 4000);
      }
    } catch (e) {
      notify(action.kind === "change" ? "Тариф не сменился" : "Оплата не открылась", e instanceof Error ? e.message : undefined);
    } finally {
      setPaying(false);
    }
  };

  const manage = async () => {
    setPaying(true);
    try {
      await openTariffPortal(scope.foreign ? scope.tenantId : null);
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

  return (
    <Screen edges={["top"]}>
      {/* Чужой аккаунт — его имя в шапке: платят за него, а не за свой. */}
      <ScreenHeader title="Тариф" subtitle={!owner || scope.foreign ? (accountName ?? undefined) : undefined} />
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 24 }}>
        <SectionCard>
          {/* Плитка — та же, что у «Тарифа» в корне Кабинета: дверь и
              страница узнаются одним пятном. */}
          <SettingsRow
            tile={SETTINGS_TILE.blue}
            icon={BadgeCheck}
            title={state.tier ? tierName(state.tier) : "—"}
            sub={tariffStatus(state, periodEnd, CAN_PAY_HERE)}
          />
          {overLimit ? (
            <>
              <Divider inset={SETTINGS_ROW_INSET} />
              <SettingsRow
                tile={SETTINGS_TILE.indigo}
                icon={Layers}
                title="Рабочие команды"
                sub={`Работают ${working.size} из ${live.length}`}
                onPress={() => router.push("/cabinet/tariff-teams" as Href)}
              />
            </>
          ) : null}
          {CAN_PAY_HERE && owner && state.paid && !state.forever ? (
            <>
              <Divider inset={SETTINGS_ROW_INSET} />
              <SettingsRow
                tile={SETTINGS_TILE.green}
                icon={CreditCard}
                title="Управление подпиской"
                onPress={paying ? undefined : () => void manage()}
              />
            </>
          ) : null}
        </SectionCard>

        {showTiers ? <SectionEyebrow>Цена</SectionEyebrow> : null}
        {(showTiers ? TIER_CARDS.filter((card) => offered.includes(card.tier)) : []).map((card) => (
          <TierTile
            key={card.tier}
            card={card}
            calendars={calendars}
            forever={state.forever}
            selected={selected === card.tier}
            mark={
              current === card.tier
                ? state.forever
                  ? // Выдан навсегда: «Ваш» рядом с ценой читалось как своя
                    // цена, хотя этот аккаунт не платит ничего.
                    "Навсегда"
                  : state.trial
                  ? "Пробный"
                  : // Партнёру тариф не «его» — аккаунта, который пригласил.
                    owner
                    ? "Ваш"
                    : "Действует"
                : null
            }
            // Выдан навсегда — выбирать нечего: ни пробного, ни оплаты.
            onPress={canPick ? () => setPicked(card.tier) : undefined}
          />
        ))}
        {/* Период — только у оплаты: пробный бесплатный, а у выданного
            навсегда и своего оплаченного кнопки нет. */}
        {showTiers && action && action.kind !== "trial" ? (
          <SegmentedControl
            options={PERIOD_OPTIONS}
            value={period}
            onChange={setPeriod}
            style={{ marginHorizontal: GUTTER, marginTop: 12 }}
          />
        ) : null}
      </ScrollView>

      {action ? (
        <View style={{ paddingHorizontal: GUTTER, paddingTop: 8, paddingBottom: 16 }}>
          <GradientButton
            label={action.label}
            loading={startTrial.isPending || paying}
            onPress={() => void run()}
          />
        </View>
      ) : null}
    </Screen>
  );
}

const PERIOD_OPTIONS = [
  { value: "month", label: "Месяц" },
  { value: "year", label: "Год" },
] as const satisfies readonly { value: BillingPeriod; label: string }[];

function TierTile({
  card,
  calendars,
  forever,
  selected: on,
  mark,
  onPress,
}: {
  card: TierCard;
  /** Живых календарей аккаунта — итог в месяц под ценой одного. */
  calendars: number;
  /** Тариф выдан навсегда: аккаунт не платит, и счёт «за столько-то
   *  календарей» ему не про что. */
  forever: boolean;
  selected: boolean;
  mark: string | null;
  onPress?: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      // Цены — только там, где за тариф можно заплатить (`pay-here.ts`).
      accessibilityLabel={CAN_PAY_HERE && !forever ? `${card.name}, ${card.monthly} в месяц` : card.name}
      onPress={onPress}
      style={{
        marginHorizontal: GUTTER,
        marginTop: 8,
        borderRadius: t.radius.card,
        borderCurve: "continuous",
        // ВЫБРАННЫЙ — ТИНТОМ, БЕЗ РАМКИ 2pt: рамка была единственной на
        // продукт; выбор везде говорит заливкой (канон шторки выбора).
        backgroundColor: on ? `${t.accent}14` : t.surface,
        boxShadow: t.cardShadow,
        paddingHorizontal: 16,
        paddingVertical: 14,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
        <Text style={{ ...TYPE.headline, color: t.ink }}>{card.name}</Text>
        {mark ? (
          <Text style={{ ...TYPE.subhead, color: t.accent }}>{mark}</Text>
        ) : null}
        <View style={{ flex: 1 }} />
        {CAN_PAY_HERE && !forever ? (
          <>
            <Text style={{ ...TYPE.headline, color: t.ink, fontVariant: ["tabular-nums"] }}>
              {card.monthly}
            </Text>
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
      {/* Выданному навсегда цены не печатаем вовсе: ни за месяц, ни за год —
          это не его счёт. */}
      {CAN_PAY_HERE && !forever ? (
        <View style={{ gap: 2 }}>
          <Text style={{ ...TYPE.subhead, color: t.ink }}>
            {`Рабочих календарей: ${calendars} — ${calendarsMonthly(calendars)} в месяц`}
          </Text>
          <Text style={{ ...TYPE.subhead, color: t.faint }}>
            {`За год — ${card.yearlyMonthly} за календарь в месяц`}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export default TariffScreen;
