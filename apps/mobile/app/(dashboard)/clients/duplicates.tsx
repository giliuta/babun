import { useMemo } from "react";
import type React from "react";
import { SectionList, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { buildStatsMap } from "@babun/shared/local/selectors/client-stats";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { Spinner } from "@/components/ui/Spinner";
import { ClientDataNotice } from "@/features/clients/ClientDataNotice";
import ClientRow from "@/features/clients/ClientRow";
import { CreatedOn } from "@/features/clients/HiddenClientsScreen";
import { ClientsCompanyRoute } from "@/features/clients/ClientsCompanyRoute";
import { useCardFieldsByTeam } from "@/features/clients/card-prefs";
import { useDefaultCountry } from "@/features/clients/default-country";
import { findDuplicateGroups } from "@/features/clients/duplicate-groups";
import { formatPhoneForDisplay } from "@/features/clients/phone";
import { useClients, useClientTags } from "@/features/clients/queries";
import { clientsOfTeam } from "@/features/clients/team-scope";
import { useAppointments } from "@/features/calendar/queries";
import { useTeams } from "@/features/reference/queries";
import { useThemeColors } from "@/theme/colors";

// «ДУБЛИ» — КАРТОЧКИ С ОДНИМ НОМЕРОМ (владелец 30.09: «дубли тоже делай»).
//
// Страница только находит. Склейка необратима и живёт там же, где жила, —
// в «⋯» карточки («Объединить с дублем»): тап по строке открывает карточку,
// на ней уже стоит плашка «Похоже, это один человек». Кнопок в строках нет
// (владелец 15.09: внутри содержимого кнопок не бывает).
//
// Команда едет адресом из «Настроек клиентов», как у архива и корзины: её
// клиенты — свои и обслуженные (`clientsOfTeam`); группа видна, если в ней
// есть хоть одна её карточка.

export default function ClientDuplicatesRoute() {
  return (
    <ClientsCompanyRoute kind="tab">
      <ClientDuplicatesScreen />
    </ClientsCompanyRoute>
  );
}

function ClientDuplicatesScreen() {
  const t = useThemeColors();
  const router = useRouter();
  const country = useDefaultCountry();
  const { team } = useLocalSearchParams<{ team?: string }>();
  const query = useClients();
  const { data: appointments = [] } = useAppointments();
  const { data: teams = [] } = useTeams();
  const { data: tags = [] } = useClientTags();
  const teamIds = useMemo(() => teams.map((tm) => tm.id), [teams]);
  const cardFieldsFor = useCardFieldsByTeam(teamIds);

  const clients = useMemo(() => query.data ?? [], [query.data]);
  const groups = useMemo(() => {
    const ofTeam = team
      ? new Set(clientsOfTeam(clients, team, appointments).map((c) => c.id))
      : undefined;
    return findDuplicateGroups(clients, ofTeam);
  }, [clients, team, appointments]);
  // Визиты и деньги под именем — те же, что в списке: по ним и решают, какую
  // карточку оставить.
  const statsMap = useMemo(() => buildStatsMap(clients, appointments), [clients, appointments]);
  const sections = useMemo(
    () => groups.map((g) => ({ key: g.key, data: g.clients })),
    [groups],
  );

  return (
    <Screen edges={["top"]}>
      <ScreenHeader
        title="Дубли"
        subtitle={team ? teams.find((tm) => tm.id === team)?.name : undefined}
      />
      {query.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <Spinner size={28} label="Загрузка: дубли" />
        </View>
      ) : query.isError ? (
        <ClientDataNotice
          fullScreen
          title="Не удалось загрузить клиентов"
          message={query.error.message}
          onRetry={() => void query.refetch()}
          retrying={query.isRefetching}
        />
      ) : sections.length === 0 ? (
        <EmptyState fill title="Дублей нет" />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(client) => client.id}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingBottom: 32 }}
          ListHeaderComponent={
            (
              <Text className="px-4 pb-1 pt-2 text-xs" style={{ color: t.sub }}>
                Откройте карточку — «⋯ → Объединить с дублем»
              </Text>
            ) as React.ReactElement
          }
          renderSectionHeader={({ section }) => (
            <SectionEyebrow>
              {formatPhoneForDisplay(section.data[0]?.phone ?? section.key, country)}
            </SectionEyebrow>
          )}
          ItemSeparatorComponent={() => (
            <View className="ml-[68px] h-px" style={{ backgroundColor: t.separator }} />
          )}
          renderItem={({ item }) => {
            const stats = statsMap.get(item.id);
            const rowTeamId = item.team_id ?? stats?.lastTeamId ?? null;
            return (
              <ClientRow
                client={item}
                stats={stats}
                teamName={rowTeamId ? (teams.find((tm) => tm.id === rowTeamId)?.name ?? null) : null}
                tags={tags}
                cardFields={cardFieldsFor(item.team_id)}
                evidence={CreatedOn(item.created_at)}
                selectionMode={false}
                picked={false}
                onPress={() => router.push(`/clients/${item.id}`)}
                onLongPress={() => router.push(`/clients/${item.id}`)}
              />
            );
          }}
        />
      )}
    </Screen>
  );
}
