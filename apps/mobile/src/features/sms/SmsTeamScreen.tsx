import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { CircleAlert, CircleCheck, History, Send } from "lucide-react-native";
import { formatCountRu } from "@babun/shared/common/utils/plural-ru";
import { Divider } from "@/components/ui/Divider";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SwitchRow } from "@/components/ui/SwitchRow";
import { useTeams } from "@/features/reference/queries";
import { notify } from "@/lib/notify";
import { useThemeColors } from "@/theme/colors";
import { useSaveSmsSettings, useSmsAccount, useSmsHistory, type SmsEvent } from "./sms-account";
import { teamStats } from "./sms-model";
import { SmsEventRows } from "./SmsEventRows";
import { SmsEventSheet } from "./SmsEventSheet";
import { SmsHistoryRow } from "./SmsHistoryRow";
import { euro, monthWords } from "./sms-words";

// SMS ОДНОЙ КОМАНДЫ (STORY-089; владелец 24.09: «шаблон под каждую команду…
// отправка через команду один… сколько сообщений отправилось через команду
// один, сколько через команду три»). Живёт внутри «Клиенты» → «SMS» —
// решение владельца «всё в клиентах», в календаре SMS нет.
//   • «Отправлять через сервис» — та же галочка, что «календари, где можно»;
//   • СЧЁТ МЕСЯЦА — сколько ушло, частей и денег, доставлено / не дошло;
//   • СОБЫТИЯ — «как у компании», свой текст или «не отправлять»;
//   • ИСТОРИЯ — последние сообщения этой команды и дверь ко всем.

export function SmsTeamScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const { teamId = "" } = useLocalSearchParams<{ teamId?: string }>();
  const account = useSmsAccount();
  const save = useSaveSmsSettings();
  const { data: teams = [] } = useTeams();
  const history = useSmsHistory(5, { teamId });
  const [editing, setEditing] = useState<SmsEvent | null>(null);

  const team = teams.find((x) => x.id === teamId);
  const data = account.data;
  const title = team?.name ?? "Команда";

  if (account.isLoading) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title={title} />
        <EmptyState state="loading" fill />
      </Screen>
    );
  }
  if (account.isError || !data?.owner || !teamId) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title={title} />
        <EmptyState
          state="error"
          fill
          subtitle={account.error instanceof Error ? account.error.message : undefined}
          action={{ label: "Повторить", onPress: () => void account.refetch() }}
        />
      </Screen>
    );
  }

  const on = data.teamIds.includes(teamId);
  const stats = teamStats(data, teamId);
  const items = history.data ?? [];

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title={title} />
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 24 }}>
        <SectionEyebrow>Отправка</SectionEyebrow>
        <SectionCard>
          <SwitchRow
            label="Отправлять через сервис"
            hint={data.enabled ? undefined : "Выключено у всей компании"}
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

        <SmsEventRows account={data} teamId={teamId} onOpen={setEditing} />

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
              router.push({ pathname: "/clients/sms-history", params: { teamId } } as unknown as Href)
            }
          />
        </SectionCard>
      </ScrollView>

      <SmsEventSheet account={data} event={editing} teamId={teamId} onClose={() => setEditing(null)} />
    </Screen>
  );
}

export default SmsTeamScreen;
