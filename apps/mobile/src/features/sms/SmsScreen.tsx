import { useEffect, useMemo, useState } from "react";
import { Platform, ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { CalendarClock, FileText, History, MessageSquare, Wallet } from "lucide-react-native";
import { formatCountRu } from "@babun/shared/common/utils/plural-ru";
import { Divider } from "@/components/ui/Divider";
import { EmptyState } from "@/components/ui/EmptyState";
import { GradientButton } from "@/components/ui/GradientButton";
import { NoticeBar } from "@/components/ui/NoticeBar";
import { PickerSheet, type PickerSheetItem } from "@/components/ui/PickerSheet";
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
  type SmsSettingsPatch,
} from "./sms-account";
import { SmsHistoryRow } from "./SmsHistoryRow";
import { balanceWords, euro, hoursWords, HOURS_OPTIONS } from "./sms-words";

// СТРАНИЦА SMS — «СОБСТВЕННЫЙ КАБИНЕТ ОТПРАВКИ SMS» КОМПАНИИ (STORY-089;
// владелец 24.09: «он видит сумму баланса… может разрешать отправлять с этой
// командой SMS или не отправлять… с его счёта списывается за каждую SMS»).
//
// Блоки сверху вниз — в порядке вопросов владельца:
//   • БАЛАНС — сколько денег и примерно сколько SMS, сколько ушло за месяц;
//   • ОТПРАВКА ЧЕРЕЗ СЕРВИС — общий выключатель и календари, где можно;
//   • АВТОМАТИЧЕСКИ — какой шаблон уходит на новую запись, напоминание и
//     отмену (у каждого повода — «Не отправлять»);
//   • ШАБЛОНЫ — дверь в справочник;
//   • ИСТОРИЯ — последние сообщения и дверь ко всем.
//
// ПОПОЛНЕНИЕ — ТОЛЬКО НА САЙТЕ (владелец: «чтоб не брал Apple»). В iOS нет
// ни кнопки, ни ссылки, ни цены — правило App Store о цифровых товарах. В
// веб-версии кнопка «Пополнить» стоит футером — одно действие экрана.

type Picking = "new" | "reminder" | "cancel" | "hours" | "topup" | null;

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

  const templateName = useMemo(() => {
    const byId = new Map(templates.map((tpl) => [tpl.id, tpl.name]));
    return (id: string | null | undefined) =>
      !id ? "Не отправлять" : (byId.get(id) ?? "Шаблон удалён");
  }, [templates]);

  const change = (patch: SmsSettingsPatch) =>
    save.mutate(patch, {
      onError: (e) => notify("Не удалось сохранить", e instanceof Error ? e.message : undefined),
    });

  const data = account.data;
  const owner = data?.owner;
  const readyTemplates = templates.filter((tpl) => tpl.enabled && tpl.body.trim());

  const templateItems = (field: keyof SmsSettingsPatch): PickerSheetItem[] => [
    {
      id: "none",
      label: "Не отправлять",
      icon: MessageSquare,
      // Серый hex, а не токен темы: строка шторки дописывает к цвету
      // прозрачность, а к rgba её не допишешь.
      color: "#8E8E93",
      onPress: () => change({ [field]: null } as SmsSettingsPatch),
    },
    ...readyTemplates.map((tpl) => ({
      id: tpl.id,
      label: tpl.name,
      hint: tpl.body,
      icon: MessageSquare,
      color: t.accent,
      onPress: () => change({ [field]: tpl.id } as SmsSettingsPatch),
    })),
  ];

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

  const autoRows: { key: Exclude<Picking, "hours" | "topup" | null>; title: string; value: string }[] = [
    { key: "new", title: "Новая запись", value: templateName(owner.autoNewTemplate) },
    { key: "reminder", title: "Напоминание", value: templateName(owner.autoReminderTemplate) },
    { key: "cancel", title: "Отмена записи", value: templateName(owner.autoCancelTemplate) },
  ];

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

        <SectionEyebrow>Отправка через сервис</SectionEyebrow>
        <SectionCard>
          <SwitchRow
            label="Отправлять через сервис"
            // Цена — только на сайте: в iOS-приложении о платном молчим
            // (решение владельца, правило App Store).
            hint={WEB ? `Отправитель «${owner.sender}» · ${euro(data.priceCents)} за SMS` : `Отправитель «${owner.sender}»`}
            value={data.enabled}
            onChange={(enabled) => change({ enabled })}
          />
          {teams.map((team) => (
            <View key={team.id}>
              <Divider inset={16} />
              <SwitchRow
                label={team.name}
                value={data.teamIds.includes(team.id)}
                disabled={!data.enabled}
                onChange={(on) =>
                  change({
                    team_ids: on
                      ? [...data.teamIds, team.id]
                      : data.teamIds.filter((id) => id !== team.id),
                  })
                }
              />
            </View>
          ))}
        </SectionCard>

        <SectionEyebrow>Автоматически</SectionEyebrow>
        <SectionCard>
          {autoRows.map((row, index) => (
            <View key={row.key}>
              {index > 0 ? <Divider inset={48} /> : null}
              <SettingsRow
                tile="neutral"
                icon={MessageSquare}
                title={row.title}
                sub={row.value}
                onPress={() => setPicking(row.key)}
              />
              {row.key === "reminder" && owner.autoReminderTemplate ? (
                <>
                  <Divider inset={48} />
                  <SettingsRow
                    tile="neutral"
                    icon={CalendarClock}
                    title="Когда напоминать"
                    sub={hoursWords(owner.reminderHours)}
                    onPress={() => setPicking("hours")}
                  />
                </>
              ) : null}
            </View>
          ))}
        </SectionCard>

        <SectionEyebrow>Шаблоны</SectionEyebrow>
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

      {(["new", "reminder", "cancel"] as const).map((key) => {
        const field =
          key === "new" ? "auto_new_template" : key === "reminder" ? "auto_reminder_template" : "auto_cancel_template";
        const current =
          key === "new" ? owner.autoNewTemplate : key === "reminder" ? owner.autoReminderTemplate : owner.autoCancelTemplate;
        return (
          <PickerSheet
            key={key}
            visible={picking === key}
            title={autoRows.find((row) => row.key === key)?.title ?? ""}
            items={templateItems(field)}
            selectedId={current ?? "none"}
            onSettings={() => router.push("/clients/sms-templates" as Href)}
            settingsLabel="Шаблоны SMS"
            onClose={() => setPicking(null)}
          />
        );
      })}
      <PickerSheet
        visible={picking === "hours"}
        title="Когда напоминать"
        items={HOURS_OPTIONS.map((hours) => ({
          id: String(hours),
          label: hoursWords(hours),
          icon: CalendarClock,
          color: t.accent,
          onPress: () => change({ reminder_hours: hours }),
        }))}
        selectedId={String(owner.reminderHours)}
        onClose={() => setPicking(null)}
      />
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
