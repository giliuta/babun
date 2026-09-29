import { ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import {
  AlarmClock,
  CalendarClock,
  CalendarPlus,
  CalendarX,
  CircleAlert,
  CircleCheck,
  Clock,
  EyeOff,
  Hand,
  Heart,
  History,
  Repeat,
  RotateCcw,
  Send,
  Trash2,
  Wallet,
  type LucideIcon,
} from "lucide-react-native";
import { formatCountRu } from "@babun/shared/common/utils/plural-ru";
import { Divider } from "@/components/ui/Divider";
import { EmptyState } from "@/components/ui/EmptyState";
import { GradientButton } from "@/components/ui/GradientButton";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { GUTTER } from "@/components/ui/tokens";
import { useTeams } from "@/features/reference/queries";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";
import {
  useDeleteTeamTemplate,
  useSaveSmsSettings,
  useSetTeamTemplateEnabled,
  useSmsAccount,
  useSmsHistory,
  useTeamTemplates,
  whenWords,
  type SmsTeamTemplate,
  type SmsWhen,
} from "./sms-account";
import { teamStats } from "./sms-model";
import { SmsHistoryRow } from "./SmsHistoryRow";
import { balanceWords, euro, monthWords } from "./sms-words";

// SMS ОДНОЙ КОМАНДЫ — В НАСТРОЙКАХ КАЛЕНДАРЯ (STORY-089; владелец 29.09:
// «открываю Команда 1 → SMS — все шаблоны этой команды; Команда 3 —
// добавляю заново… баланс единый, независимо от команды»).
//
// Блоки сверху вниз:
//   • БАЛАНС — общий у компании: одна строка-дверь в Кабинет → SMS, где
//     пополняют и видят всё;
//   • ОТПРАВКА — «Отправлять SMS этой команды»;
//   • ШАБЛОНЫ — строка на шаблон: название и «когда» («Накануне в 18:00»).
//     Тап — настройка; свайп влево — «Удалить», вправо — «Выключить» /
//     «Включить» (канон справочников, как у типов событий и меток);
//   • СЧЁТ МЕСЯЦА — сколько ушло, доставлено, не доставлено;
//   • ИСТОРИЯ — последние сообщения команды и дверь ко всем.
// Действие экрана одно — «Добавить шаблон» внизу.

/** Значок «когда» — строка читается глазом раньше, чем словом. */
const WHEN_ICON: Record<SmsWhen, LucideIcon> = {
  manual: Hand,
  created: CalendarPlus,
  before: AlarmClock,
  day_before: Clock,
  rescheduled: CalendarClock,
  cancelled: CalendarX,
  after: Heart,
  repeat: Repeat,
};

export function SmsTeamScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ team?: string }>();
  const { data: teams = [] } = useTeams();
  const team = teams.find((x) => x.id === params.team) ?? teams[0];
  const teamId = team?.id ?? "";
  const account = useSmsAccount();
  const save = useSaveSmsSettings();
  const templates = useTeamTemplates(teamId || null);
  const toggle = useSetTeamTemplateEnabled();
  const remove = useDeleteTeamTemplate();
  const history = useSmsHistory(5, { teamId });

  const data = account.data;
  const owner = data?.owner;
  const subtitle = team?.name;

  if (account.isLoading || templates.isLoading) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="SMS" subtitle={subtitle} />
        <EmptyState state="loading" fill />
      </Screen>
    );
  }
  if (account.isError || templates.isError || !data || !owner || !teamId) {
    const error = account.error ?? templates.error;
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="SMS" subtitle={subtitle} />
        <EmptyState
          state="error"
          fill
          subtitle={error instanceof Error ? error.message : undefined}
          action={{
            label: "Повторить",
            onPress: () => {
              void account.refetch();
              void templates.refetch();
            },
          }}
        />
      </Screen>
    );
  }

  const list = templates.data ?? [];
  const on = data.teamIds.includes(teamId);
  const stats = teamStats(data, teamId);
  const items = history.data ?? [];

  const open = (template: SmsTeamTemplate | null) =>
    router.push({
      pathname: "/calendar/sms-template",
      params: template ? { team: teamId, id: template.id } : { team: teamId },
    } as unknown as Href);

  const drop = (template: SmsTeamTemplate) =>
    confirmThen(
      `Удалить шаблон «${template.name}»?`,
      {
        message: "Отправленные SMS останутся в истории, неотправленные по нему — не уйдут.",
        confirmLabel: "Удалить",
        destructive: true,
      },
      () =>
        remove.mutate(template.id, {
          onError: (e) => notify("Не удалось удалить", e instanceof Error ? e.message : undefined),
        }),
    );

  const flip = (template: SmsTeamTemplate) =>
    toggle.mutate(
      { id: template.id, enabled: !template.enabled },
      { onError: (e) => notify("Не удалось сохранить", e instanceof Error ? e.message : undefined) },
    );

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="SMS" subtitle={subtitle} />
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 24 }}>
        <SectionEyebrow>Баланс</SectionEyebrow>
        <SectionCard>
          <SettingsRow
            tile="neutral"
            icon={Wallet}
            title="Баланс компании"
            sub={balanceWords(owner.balanceCents, owner.freeLeft, data.priceCents)}
            value={euro(owner.balanceCents)}
            valueQuiet={owner.balanceCents === 0}
            onPress={() => router.push("/cabinet/sms" as Href)}
          />
        </SectionCard>

        <SectionEyebrow>Отправка</SectionEyebrow>
        <SectionCard>
          <SwitchRow
            label="Отправлять SMS этой команды"
            hint={data.enabled ? undefined : "Выключено в Кабинете → SMS"}
            value={on}
            disabled={!data.enabled}
            onChange={(next) =>
              save.mutate(
                {
                  team_ids: next ? [...data.teamIds, teamId] : data.teamIds.filter((id) => id !== teamId),
                },
                { onError: (e) => notify("Не удалось сохранить", e instanceof Error ? e.message : undefined) },
              )
            }
          />
        </SectionCard>

        <SectionEyebrow>
          {list.length > 0 ? `Шаблоны · ${list.length}` : "Шаблоны"}
        </SectionEyebrow>
        <SectionCard>
          {list.length === 0 ? (
            <SettingsRow tile="neutral" icon={Send} title="Шаблонов нет" />
          ) : (
            list.map((template, index) => (
              <View key={template.id}>
                {index > 0 ? <Divider inset={48} /> : null}
                <SwipeRow
                  label="Удалить"
                  color={t.danger}
                  icon={Trash2}
                  accessibilityLabel={`Удалить шаблон ${template.name}`}
                  onAction={() => drop(template)}
                  leading={{
                    label: template.enabled ? "Выключить" : "Включить",
                    color: template.enabled ? t.warning : t.success,
                    icon: template.enabled ? EyeOff : RotateCcw,
                    accessibilityLabel: template.enabled
                      ? `Выключить шаблон ${template.name}`
                      : `Включить шаблон ${template.name}`,
                    onAction: () => flip(template),
                  }}
                >
                  <View style={{ backgroundColor: t.surface, opacity: template.enabled ? 1 : 0.5 }}>
                    <SettingsRow
                      tile="neutral"
                      icon={WHEN_ICON[template.trigger]}
                      title={template.name}
                      sub={template.enabled ? whenWords(template) : `Выключен · ${whenWords(template)}`}
                      onPress={() => open(template)}
                    />
                  </View>
                </SwipeRow>
              </View>
            ))
          )}
        </SectionCard>

        <SectionEyebrow>{monthWords(new Date())}</SectionEyebrow>
        <SectionCard>
          <SettingsRow
            tile="neutral"
            icon={Send}
            title="Отправлено"
            sub={`${formatCountRu(stats.segments, ["часть", "части", "частей"])} · ${euro(stats.cents)}`}
            value={`${stats.count} SMS`}
            valueQuiet={stats.count === 0}
          />
          <Divider inset={48} />
          <SettingsRow
            tile="neutral"
            icon={CircleCheck}
            title="Доставлено"
            value={String(stats.delivered)}
            valueQuiet={stats.delivered === 0}
          />
          <Divider inset={48} />
          <SettingsRow
            tile="neutral"
            icon={CircleAlert}
            title="Не доставлено"
            value={String(stats.failed)}
            valueColor={stats.failed > 0 ? t.danger : undefined}
            valueQuiet={stats.failed === 0}
          />
        </SectionCard>

        <SectionEyebrow>История</SectionEyebrow>
        <SectionCard>
          {items.map((item, index) => (
            <View key={item.id}>
              {index > 0 ? <Divider inset={16} /> : null}
              <SmsHistoryRow item={item} />
            </View>
          ))}
          {items.length > 0 ? <Divider inset={48} /> : null}
          <SettingsRow
            tile="neutral"
            icon={History}
            title="Вся история"
            sub={items.length > 0 ? undefined : "Сообщений пока нет"}
            onPress={() =>
              router.push({ pathname: "/calendar/sms-history", params: { teamId } } as unknown as Href)
            }
          />
        </SectionCard>
      </ScrollView>

      <View style={{ paddingHorizontal: GUTTER, paddingTop: 8, paddingBottom: 16 }}>
        <GradientButton label="Добавить шаблон" onPress={() => open(null)} />
      </View>
    </Screen>
  );
}

export default SmsTeamScreen;
