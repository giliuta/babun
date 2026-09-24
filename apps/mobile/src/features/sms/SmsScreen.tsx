import { useEffect, useState } from "react";
import { Platform, ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { CalendarClock, FileText, History, Moon, Users, Wallet } from "lucide-react-native";
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
import { useSmsTemplates } from "@/features/settings/sms-templates";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";
import {
  startSmsTopup,
  TOPUP_AMOUNTS_CENTS,
  useSaveSmsSettings,
  useSmsAccount,
  useSmsHistory,
  type SmsEvent,
  type SmsSettingsPatch,
} from "./sms-account";
import { teamStats } from "./sms-model";
import { SmsEventRows } from "./SmsEventRows";
import { SmsEventSheet } from "./SmsEventSheet";
import { SmsHistoryRow } from "./SmsHistoryRow";
import { balanceWords, euro, QUIET_OPTIONS, quietWords } from "./sms-words";

// СТРАНИЦА SMS — «СОБСТВЕННЫЙ КАБИНЕТ ОТПРАВКИ SMS» КОМПАНИИ (STORY-089;
// владелец 24.09: «он видит сумму баланса… может разрешать отправлять с этой
// командой SMS или не отправлять… с его счёта списывается за каждую SMS»).
//
// Владелец 24.09: «новая запись — свой шаблон, напоминание — свой, отмена —
// свой… шаблон под каждую команду… сколько сообщений ушло через команду
// один, сколько через команду три»; решение — всё здесь, в «Клиенты» →
// «SMS», с разделом на каждую команду (разбор — STORY-089-sms-analysis).
//
// Блоки сверху вниз:
//   • БАЛАНС — сколько денег и примерно сколько SMS, сколько ушло за месяц;
//   • ОТПРАВКА — общий выключатель и тихие часы;
//   • КОМАНДЫ — строка на команду: отправляет ли, сколько SMS и денег за
//     месяц, сколько своих текстов; тап — страница команды;
//   • ДО ВИЗИТА / ИЗМЕНЕНИЯ / ПОСЛЕ ВИЗИТА — события компании: у каждого
//     свой текст, своё «вкл» и срок; команда берёт их, пока не задаст своё;
//   • РУЧНАЯ ОТПРАВКА — дверь в шаблоны листа «SMS» у номера;
//   • ИСТОРИЯ — последние сообщения и дверь ко всем.
//
// ПОПОЛНЕНИЕ — ТОЛЬКО НА САЙТЕ (владелец: «чтоб не брал Apple»). В iOS нет
// ни кнопки, ни ссылки, ни цены — правило App Store о цифровых товарах. В
// веб-версии кнопка «Пополнить» стоит футером — одно действие экрана.

type Picking = "quiet" | "topup" | null;

const WEB = Platform.OS === "web";

export function SmsScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const toast = useToast();
  const params = useLocalSearchParams<{ topup?: string }>();
  const account = useSmsAccount();
  const save = useSaveSmsSettings();
  const templates = useSmsTemplates().data ?? [];
  const history = useSmsHistory(5);
  const { data: teams = [] } = useTeams();
  const [picking, setPicking] = useState<Picking>(null);
  const [editing, setEditing] = useState<SmsEvent | null>(null);

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
  const readyTemplates = templates.filter((tpl) => tpl.enabled && tpl.body.trim());

  const topup = async (cents: number) => {
    try {
      const back = typeof window !== "undefined" ? `${window.location.origin}/clients/sms` : undefined;
      const url = await startSmsTopup(cents, back ?? "https://babun.app/clients/sms");
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
  // Сотруднику баланс и настройки не приходят: SMS компании ведёт владелец.
  if (data && !owner) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="SMS" />
        <EmptyState fill title="SMS настраивает владелец компании" />
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

  const ownTexts = (teamId: string) => owner.teamRules.filter((r) => r.teamId === teamId).length;
  const teamSub = (teamId: string): string => {
    if (!data.enabled || !data.teamIds.includes(teamId)) return "Не отправляет";
    const parts = [formatCountRu(teamStats(data, teamId).count, ["SMS", "SMS", "SMS"])];
    const own = ownTexts(teamId);
    if (own > 0) parts.push(formatCountRu(own, ["свой текст", "своих текста", "своих текстов"]));
    return parts.join(" · ");
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
          <Divider inset={48} />
          <SettingsRow
            tile="neutral"
            icon={Moon}
            title="Тихие часы"
            sub={quietWords(owner.quietFrom, owner.quietTo)}
            onPress={() => setPicking("quiet")}
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
                        router.push({ pathname: "/clients/sms-team", params: { teamId: team.id } } as unknown as Href)
                      }
                    />
                  </View>
                );
              })}
            </SectionCard>
          </>
        ) : null}

        <SmsEventRows account={data} teamId="" onOpen={setEditing} />

        <SectionEyebrow>Ручная отправка</SectionEyebrow>
        <SectionCard>
          <SettingsRow
            tile="neutral"
            icon={FileText}
            title="Шаблоны SMS"
            sub={
              readyTemplates.length > 0
                ? formatCountRu(readyTemplates.length, ["шаблон", "шаблона", "шаблонов"])
                : "Шаблонов нет"
            }
            onPress={() => router.push("/clients/sms-templates" as Href)}
          />
        </SectionCard>

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
            onPress={() => router.push("/clients/sms-history" as Href)}
          />
        </SectionCard>
      </ScrollView>

      {WEB ? (
        <View style={{ paddingHorizontal: GUTTER, paddingTop: 8, paddingBottom: 16 }}>
          <GradientButton label="Пополнить баланс" onPress={() => setPicking("topup")} />
        </View>
      ) : null}

      <PickerSheet
        visible={picking === "quiet"}
        title="Тихие часы"
        subtitle="Автоматические SMS в это время ждут утра"
        items={QUIET_OPTIONS.map((q) => ({
          id: `${q.from}-${q.to}`,
          label: quietWords(q.from, q.to),
          icon: Moon,
          color: t.accent,
          onPress: () => change({ quiet_from: q.from, quiet_to: q.to }),
        }))}
        selectedId={`${owner.quietFrom}-${owner.quietTo}`}
        onClose={() => setPicking(null)}
      />
      <SmsEventSheet account={data} event={editing} teamId="" onClose={() => setEditing(null)} />
      {WEB ? (
        <PickerSheet
          visible={picking === "topup"}
          title="Пополнить баланс"
          items={TOPUP_AMOUNTS_CENTS.map((cents) => ({
            id: String(cents),
            label: euro(cents),
            hint: `≈ ${Math.floor(cents / data.priceCents)} SMS`,
            icon: Wallet,
            color: t.accent,
            onPress: () => void topup(cents),
          }))}
          onClose={() => setPicking(null)}
        />
      ) : null}
    </Screen>
  );
}

export default SmsScreen;
