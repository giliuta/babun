import { useEffect, useState } from "react";
import { Platform, ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { CalendarClock, History, Users, Wallet } from "lucide-react-native";
import { formatCountRu } from "@babun/shared/common/utils/plural-ru";
import { Divider } from "@/components/ui/Divider";
import { EmptyState } from "@/components/ui/EmptyState";
import { GradientButton } from "@/components/ui/GradientButton";
import { NoticeBar } from "@/components/ui/NoticeBar";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { GUTTER } from "@/components/ui/tokens";
import { useToast } from "@/components/ui/Toast";
import { useTeams } from "@/features/reference/queries";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";
import {
  startSmsTopup,
  TOPUP_AMOUNTS_CENTS,
  useSaveSmsSettings,
  useSmsAccount,
  useSmsHistory,
  type SmsSettingsPatch,
} from "./sms-account";
import { teamStats } from "./sms-model";
import { SmsHistoryRow } from "./SmsHistoryRow";
import { balanceWords, euro } from "./sms-words";

// КАБИНЕТ → SMS — ДЕНЬГИ И ОТПРАВКА ВСЕЙ КОМПАНИИ (STORY-089; владелец
// 29.09: «первое — баланс и пополнение, это всё будет Кабинет SMS… потом
// шаблоны и всё остальное — это уже в другом»; «баланс единый, независимо
// от команды»).
//
// Блоки сверху вниз:
//   • БАЛАНС — сколько денег и примерно сколько SMS, сколько ушло за месяц;
//   • ОТПРАВКА — общий выключатель «Отправлять через сервис»;
//   • КОМАНДЫ — строка на команду: отправляет ли, сколько у неё шаблонов,
//     сколько денег за месяц; тап — SMS этой команды (её шаблоны живут в
//     настройках календаря);
//   • ИСТОРИЯ — последние сообщения и дверь ко всем.
//
// ПОПОЛНЕНИЕ — ТОЛЬКО НА САЙТЕ (владелец 24.09: «чтоб не брал Apple»). В iOS
// нет ни кнопки, ни ссылки, ни цены — правило App Store о цифровых товарах.
// В веб-версии «Пополнить баланс» стоит футером — одно действие экрана.

const WEB = Platform.OS === "web";

export function SmsScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const toast = useToast();
  const params = useLocalSearchParams<{ topup?: string }>();
  const account = useSmsAccount();
  const save = useSaveSmsSettings();
  const history = useSmsHistory(5);
  const { data: teams = [] } = useTeams();
  const [topupOpen, setTopupOpen] = useState(false);

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

  const change = (patch: SmsSettingsPatch) =>
    save.mutate(patch, {
      onError: (e) => notify("Не удалось сохранить", e instanceof Error ? e.message : undefined),
    });

  const data = account.data;
  const owner = data?.owner;

  const topup = async (cents: number) => {
    try {
      const back = typeof window !== "undefined" ? `${window.location.origin}/cabinet/sms` : undefined;
      const url = await startSmsTopup(cents, back ?? "https://babun.app/cabinet/sms");
      if (typeof window !== "undefined") window.location.assign(url);
    } catch (e) {
      notify("Оплата не открылась", e instanceof Error ? e.message : undefined);
    }
  };

  if (account.isLoading) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="SMS" />
        <EmptyState state="loading" fill />
      </Screen>
    );
  }
  if (account.isError || !data || !owner) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="SMS" />
        <EmptyState
          state="error"
          fill
          subtitle={account.error instanceof Error ? account.error.message : undefined}
          action={{ label: "Повторить", onPress: () => void account.refetch() }}
        />
      </Screen>
    );
  }

  const teamSub = (teamId: string): string => {
    const count = owner.templateCounts[teamId] ?? 0;
    const templates = count > 0 ? formatCountRu(count, ["шаблон", "шаблона", "шаблонов"]) : "Шаблонов нет";
    const sends = data.enabled && data.teamIds.includes(teamId);
    return `${templates} · ${sends ? "Отправляет" : "Не отправляет"}`;
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="SMS" />
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 24 }}>
        {!data.serviceOn ? (
          <View style={{ marginHorizontal: GUTTER, marginTop: 12 }}>
            <NoticeBar tone="info" message="Сервис SMS ещё не подключён" />
          </View>
        ) : null}

        <SectionEyebrow>Баланс</SectionEyebrow>
        <SectionCard>
          <SettingsRow
            tile="neutral"
            icon={Wallet}
            title="Баланс"
            sub={balanceWords(owner.balanceCents, owner.freeLeft, data.priceCents)}
            value={euro(owner.balanceCents)}
            valueQuiet={owner.balanceCents === 0}
          />
          <Divider inset={48} />
          <SettingsRow
            tile="neutral"
            icon={CalendarClock}
            title="За месяц"
            sub={formatCountRu(owner.monthCount, ["SMS", "SMS", "SMS"])}
            value={euro(owner.monthCents)}
            valueQuiet={owner.monthCents === 0}
          />
        </SectionCard>

        <SectionEyebrow>Отправка</SectionEyebrow>
        <SectionCard>
          <SwitchRow
            label="Отправлять через сервис"
            // Цена — только на сайте: в iOS-приложении о платном молчим
            // (решение владельца, правило App Store).
            hint={WEB ? `Отправитель «${owner.sender}» · ${euro(data.priceCents)} за SMS` : `Отправитель «${owner.sender}»`}
            value={data.enabled}
            onChange={(enabled) => change({ enabled })}
          />
        </SectionCard>

        {teams.length > 0 ? (
          <>
            <SectionEyebrow>Команды</SectionEyebrow>
            <SectionCard>
              {teams.map((team, index) => {
                const stats = teamStats(data, team.id);
                return (
                  <View key={team.id}>
                    {index > 0 ? <Divider inset={48} /> : null}
                    <SettingsRow
                      appearance={{ color: team.color, icon: team.icon, fallback: Users }}
                      title={team.name}
                      sub={teamSub(team.id)}
                      value={stats.cents > 0 ? euro(stats.cents) : undefined}
                      onPress={() =>
                        router.push({ pathname: "/calendar/sms", params: { team: team.id } } as unknown as Href)
                      }
                    />
                  </View>
                );
              })}
            </SectionCard>
          </>
        ) : null}

        <SectionEyebrow>История</SectionEyebrow>
        <SectionCard>
          {(history.data ?? []).map((item, index) => (
            <View key={item.id}>
              {index > 0 ? <Divider inset={16} /> : null}
              <SmsHistoryRow item={item} />
            </View>
          ))}
          {(history.data ?? []).length > 0 ? <Divider inset={48} /> : null}
          <SettingsRow
            tile="neutral"
            icon={History}
            title="Вся история"
            sub={(history.data ?? []).length > 0 ? undefined : "Сообщений пока нет"}
            onPress={() => router.push("/cabinet/sms-history" as Href)}
          />
        </SectionCard>
      </ScrollView>

      {WEB ? (
        <View style={{ paddingHorizontal: GUTTER, paddingTop: 8, paddingBottom: 16 }}>
          <GradientButton label="Пополнить баланс" onPress={() => setTopupOpen(true)} />
        </View>
      ) : null}

      {WEB ? (
        <PickerSheet
          visible={topupOpen}
          title="Пополнить баланс"
          items={TOPUP_AMOUNTS_CENTS.map((cents) => ({
            id: String(cents),
            label: euro(cents),
            hint: `≈ ${Math.floor(cents / data.priceCents)} SMS`,
            icon: Wallet,
            color: t.accent,
            onPress: () => void topup(cents),
          }))}
          onClose={() => setTopupOpen(false)}
        />
      ) : null}
    </Screen>
  );
}

export default SmsScreen;
