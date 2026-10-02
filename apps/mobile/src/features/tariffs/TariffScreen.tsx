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
import { SettingsRow } from "@/components/ui/SettingsRow";
import { useToast } from "@/components/ui/Toast";
import { GUTTER, TYPE } from "@/components/ui/tokens";
import { useTeams } from "@/features/reference/queries";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";
import {
  TIER_CARDS,
  TIER_LIMITS,
  tariffAction,
  tariffStatus,
  tierName,
  workingTeamIds,
  type Tier,
  type TierCard,
} from "./tiers";
import { openTariffCheckout, openTariffPortal, useStartTrial, useTariff } from "./use-tariff";

// КАБИНЕТ → ТАРИФ (владелец 01.10): «Соло · Про · Макс», пробный 14 дней без
// карты — один раз, на выбранный тариф; оплата — страница Stripe в браузере.
//
// Сверху — что действует сейчас; ниже — три тарифа плитками, тап выбирает;
// действие страницы одно, в футере: «Попробовать 14 дней», «Оплатить» или,
// когда подписка уже есть, «Перейти на …». Подписка есть — строка
// «Управление подпиской» (страница Stripe: карта, счета, отмена). Команд
// больше лимита — строка «Рабочие команды» ведёт к выбору, какие работают;
// остальные только смотрят.
//
// Тариф после оплаты приходит вебхуком Stripe: вернулся из браузера —
// профиль перечитывается.

export function TariffScreen() {
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const { state, periodEnd, workingChosen } = useTariff();
  const { data: teams = [] } = useTeams();
  const startTrial = useStartTrial();
  const [paying, setPaying] = useState(false);
  const current = state.tier && state.tier !== "free" ? state.tier : null;
  // Выбор человека; пока не выбирал — действующий тариф (профиль может
  // приехать после первого кадра).
  const [picked, setPicked] = useState<Exclude<Tier, "free"> | null>(null);
  const selected = picked ?? current ?? "solo";

  // Вернулся из браузера (оплата, управление подпиской) — перечитать тариф.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") void qc.invalidateQueries({ queryKey: ["tenant"] });
    });
    return () => sub.remove();
  }, [qc]);

  const live = teams.filter((team) => team.is_active !== false);
  const limit = state.tier ? TIER_LIMITS[state.tier].teams : live.length;
  const overLimit = live.length > limit;
  const working = workingTeamIds(live, state.tier, workingChosen);
  const action = tariffAction(state, selected);

  const run = async () => {
    if (!action) return;
    if (action.kind === "trial") {
      try {
        await startTrial.mutateAsync(selected);
        toast(`Пробный «${tierName(selected)}» — 14 дней`, "success");
      } catch (e) {
        notify("Пробный не включился", e instanceof Error ? e.message : undefined);
      }
      return;
    }
    setPaying(true);
    try {
      const result = await openTariffCheckout(selected);
      if (result === "changed") {
        toast(`Тариф меняется на «${tierName(selected)}»`, "success");
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
      await openTariffPortal();
    } catch (e) {
      notify("Подписка не открылась", e instanceof Error ? e.message : undefined);
    } finally {
      setPaying(false);
    }
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Тариф" />
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 24 }}>
        <SectionCard>
          <SettingsRow
            tile="neutral"
            icon={BadgeCheck}
            title={state.tier ? tierName(state.tier) : "—"}
            sub={tariffStatus(state, periodEnd)}
          />
          {overLimit ? (
            <>
              <Divider inset={48} />
              <SettingsRow
                tile="neutral"
                icon={Layers}
                title="Рабочие команды"
                sub={`Работают ${working.size} из ${live.length}`}
                onPress={() => router.push("/cabinet/tariff-teams" as Href)}
              />
            </>
          ) : null}
          {state.paid && !state.forever ? (
            <>
              <Divider inset={48} />
              <SettingsRow
                tile="neutral"
                icon={CreditCard}
                title="Управление подпиской"
                onPress={paying ? undefined : () => void manage()}
              />
            </>
          ) : null}
        </SectionCard>

        <SectionEyebrow>Тарифы</SectionEyebrow>
        {TIER_CARDS.map((card) => (
          <TierTile
            key={card.tier}
            card={card}
            selected={selected === card.tier}
            mark={
              current === card.tier
                ? state.trial
                  ? "Пробный"
                  : "Ваш"
                : null
            }
            // Выдан навсегда — выбирать нечего: ни пробного, ни оплаты.
            onPress={state.forever ? undefined : () => setPicked(card.tier)}
          />
        ))}
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

function TierTile({
  card,
  selected: on,
  mark,
  onPress,
}: {
  card: TierCard;
  selected: boolean;
  mark: string | null;
  onPress?: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      accessibilityLabel={`${card.name}, ${card.monthly} в месяц`}
      onPress={onPress}
      style={{
        marginHorizontal: GUTTER,
        marginTop: 8,
        borderRadius: t.radius.card,
        borderCurve: "continuous",
        backgroundColor: t.surface,
        boxShadow: t.cardShadow,
        borderWidth: 2,
        borderColor: on ? t.accent : "transparent",
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
        <Text style={{ ...TYPE.headline, color: t.ink, fontVariant: ["tabular-nums"] }}>
          {card.monthly}
        </Text>
        <Text style={{ ...TYPE.subhead, color: t.faint }}>в месяц</Text>
      </View>
      <View style={{ gap: 6 }}>
        {card.includes.map((line) => (
          <View key={line} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Check size={14} color={t.accent} strokeWidth={2.4} />
            <Text style={{ ...TYPE.body, color: t.sub }}>{line}</Text>
          </View>
        ))}
      </View>
      <Text style={{ ...TYPE.subhead, color: t.faint }}>
        {`За год — ${card.yearlyMonthly} в месяц`}
      </Text>
    </Pressable>
  );
}

export default TariffScreen;
