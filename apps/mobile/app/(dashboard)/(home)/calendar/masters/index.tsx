import { useMemo, useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { Search } from "lucide-react-native";
import { getInitials } from "@babun/shared/local/masters";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Divider } from "@/components/ui/Divider";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { GradientButton } from "@/components/ui/GradientButton";
import { useThemeColors } from "@/theme/colors";
import { readableForeground } from "@/theme/readable-color";
import { useMasters, useTeams, type Master } from "@/features/reference/queries";
import { usePendingInvitations } from "@/features/settings/team-access";
import { refusalOf } from "@/features/access/access-map";
import { InviteMemberSheet } from "@/features/access/InviteMemberSheet";
import { MemberRow, PendingInvitationRow } from "@/features/access/PeopleRows";
import { AccessRequestError, useCalendarMembers } from "@/features/access/queries";

// Мастера календаря — корневой экран nav-хаба (masters/index.tsx). Сверху люди
// с доступом к календарю и приглашения, на которые ещё не ответили; ниже
// старые карточки мастеров (строка пушит на хаб ./[id]).
//
// «ДОБАВИТЬ МАСТЕРА» — ПРИГЛАШЕНИЕ ПО ПОЧТЕ (владелец 2026-09-14 на модалке
// «Новый мастер · Имя · Телефон»: «мы договорились по почте»). Модалка,
// заводившая карточку без аккаунта, снесена: без аккаунта мастера не заводим
// (STORY-081). Шторка приглашения — `features/access/InviteMemberSheet`.
export default function MastersScreen() {
  const t = useThemeColors();
  const router = useRouter();
  // Включая архивных: «Вернуть из архива» живёт в хабе мастера, и без
  // архивного хвоста в списке он недостижим (аудит P1-10). Активные
  // сверху, архив серым снизу.
  const mastersQuery = useMasters({ includeInactive: true });
  const {
    data: allMasters = [],
    isLoading,
    isError,
    error,
    refetch,
  } = mastersQuery;
  const sortedMasters = useMemo(
    () => [
      ...allMasters.filter((m) => m.is_active),
      ...allMasters.filter((m) => !m.is_active),
    ],
    [allMasters],
  );
  const teamsQuery = useTeams();
  const teams = useMemo(() => teamsQuery.data ?? [], [teamsQuery.data]);

  const [search, setSearch] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);

  const masters = useMemo(() => {
    const needle = normalizeSearch(search);
    if (!needle) return sortedMasters;
    return sortedMasters.filter((master) => {
      const profile = asRecord(master.profile);
      return normalizeSearch([
        master.full_name,
        master.phone,
        typeof profile.email === "string" ? profile.email : "",
        typeof profile.login_email === "string" ? profile.login_email : "",
      ].filter(Boolean).join(" ")).includes(needle);
    });
  }, [search, sortedMasters]);

  // ЛЮДИ С ДОСТУПОМ К ЭТОМУ КАЛЕНДАРЮ (STORY-081). Сотрудник теперь — аккаунт,
  // прикреплённый к календарю, а не карточка по имени и телефону: у Giliuta
  // карточек ноль, и человека с доступом к «Команде 1» в списке не было вовсе
  // (владелец 2026-09-14: «захожу в мастера — ничего не вижу»). Календарь
  // приходит адресом из его настроек; без адреса раздела нет.
  const params = useLocalSearchParams<{ team?: string | string[] }>();
  const teamId = Array.isArray(params.team) ? params.team[0] : params.team;
  const teamName = teamId ? teams.find((team) => team.id === teamId)?.name : undefined;
  const membersQuery = useCalendarMembers(teamId);
  // Владельца в разделе нет: его права не меняются (сервер: access:target_owner).
  const staff = useMemo(
    () => (membersQuery.data ?? []).filter((member) => member.role !== "owner"),
    [membersQuery.data],
  );
  const members = useMemo(() => {
    const needle = normalizeSearch(search);
    if (!needle) return staff;
    return staff.filter((member) =>
      normalizeSearch(`${member.name} ${member.email} ${member.phone ?? ""}`).includes(needle),
    );
  }, [staff, search]);
  // Отказ «людей видит владелец» — не беда: раздела просто нет. Любая другая
  // ошибка называется вслух, иначе пустой список соврёт «Нет мастеров».
  const membersFailed =
    membersQuery.isError &&
    !(membersQuery.error instanceof AccessRequestError && refusalOf(membersQuery.error) === "not_owner");

  // ПРИГЛАШЕНИЯ В ЭТОТ КАЛЕНДАРЬ БЕЗ ОТВЕТА. Без них «Пригласить» уходило бы в
  // пустоту: ни следа на экране, ни способа отправить ссылку ещё раз.
  const invitationsQuery = usePendingInvitations();
  const calendarInvitations = useMemo(
    () => (teamId ? (invitationsQuery.data ?? []).filter((inv) => inv.team_id === teamId) : []),
    [invitationsQuery.data, teamId],
  );
  const pending = useMemo(() => {
    const needle = normalizeSearch(search);
    if (!needle) return calendarInvitations;
    return calendarInvitations.filter((inv) => normalizeSearch(inv.email).includes(needle));
  }, [calendarInvitations, search]);

  const hasAnyone = allMasters.length > 0 || staff.length > 0 || calendarInvitations.length > 0;
  const hasPeople = members.length > 0 || pending.length > 0;

  // Тинт аватара по основной команде мастера (цвет команды), как на вебе.
  const teamColorById = useMemo(() => {
    const m = new Map<string, string>();
    for (const team of teams) if (team.color) m.set(team.id, team.color);
    return m;
  }, [teams]);

  return (
    <Screen edges={["top"]}>
      {/* ЧЕЙ ЭТО СОСТАВ — ПОД ИМЕНЕМ ЭКРАНА (владелец 14.09: «под словом
          мастера написать Команда 1»). Так же, как у «Меток» и у шторки
          «Пригласить мастера»: раздел и приглашение живут в одном календаре. */}
      <ScreenHeader title="Мастера" subtitle={teamName} />

      {isLoading || teamsQuery.isLoading || membersQuery.isLoading || invitationsQuery.isLoading ? (
        <EmptyState state="loading" fill />
      ) : isError || teamsQuery.isError ? (
        <EmptyState
          fill
          state="error"
          subtitle={
            (error || teamsQuery.error) instanceof Error
              ? ((error || teamsQuery.error) as Error).message
              : undefined
          }
          action={{
            label: "Повторить",
            onPress: () => void Promise.all([refetch(), teamsQuery.refetch()]),
          }}
        />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={masters}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ flexGrow: 1 }}
          ListHeaderComponent={
            <>
              {hasAnyone ? (
                <View
                  className="mx-3 mb-2 mt-2 h-11 flex-row items-center rounded-[10px] px-3"
                  style={{ backgroundColor: t.fill }}
                >
                  <Search color={t.faint} size={17} />
                  <TextInput
                    value={search}
                    onChangeText={setSearch}
                    placeholder="Имя, телефон или email"
                    placeholderTextColor={t.placeholder}
                    keyboardAppearance="light"
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="search"
                    accessibilityLabel="Поиск мастера"
                    className="ml-2 flex-1 text-[15px]"
                    style={{ color: t.ink }}
                  />
                </View>
              ) : null}
              {members.length > 0 ? (
                <View>
                  <SectionEyebrow>С доступом к календарю</SectionEyebrow>
                  {members.map((member, i) => (
                    <View key={member.userId}>
                      {i > 0 ? <Divider inset={64} /> : null}
                      <MemberRow
                        member={member}
                        tint={(teamId && teamColorById.get(teamId)) || t.faint}
                        onPress={() =>
                          router.push(
                            `/calendar/masters/access/${member.userId}?team=${encodeURIComponent(teamId ?? "")}` as Href,
                          )
                        }
                      />
                    </View>
                  ))}
                </View>
              ) : null}
              {pending.length > 0 ? (
                <View>
                  <SectionEyebrow>Ждут ответа</SectionEyebrow>
                  {pending.map((invitation, i) => (
                    <View key={invitation.id}>
                      {i > 0 ? <Divider inset={64} /> : null}
                      <PendingInvitationRow invitation={invitation} />
                    </View>
                  ))}
                </View>
              ) : null}
              {membersFailed ? (
                <EmptyState
                  state="error"
                  title="Не удалось загрузить людей с доступом"
                  action={{ label: "Повторить", onPress: () => void membersQuery.refetch() }}
                />
              ) : null}
              {hasPeople && masters.length > 0 ? (
                <SectionEyebrow>Карточки мастеров</SectionEyebrow>
              ) : null}
            </>
          }
          renderItem={({ item }) => (
            <MasterRow
              master={item}
              tint={
                item.team_id ? teamColorById.get(item.team_id) ?? t.faint : t.faint
              }
              onPress={() => router.push(`/calendar/masters/${item.id}`)}
            />
          )}
          ItemSeparatorComponent={() => <Divider inset={64} />}
          ListEmptyComponent={
            hasPeople || membersFailed ? null : (
              <EmptyState
                fill
                title={search.trim() ? "Ничего не найдено" : "Нет мастеров"}
                subtitle={search.trim() ? "Измените имя, телефон или email в поиске." : undefined}
              />
            )
          }
        />
      )}

      {/* ГЛАВНОЕ ДЕЙСТВИЕ — ВНИЗУ ЭКРАНА (владелец 2026-09-10: «кнопка должна
          быть внизу, как и всё у нас»). Тот же футер, что у списка клиентов:
          20 по бокам, 8 сверху, 10 снизу, `GradientButton` во всю ширину.

          ЗДЕСЬ БЫЛО ДВЕ РАЗНЫХ ДВЕРИ: строка `AddRow` в конце списка, когда
          мастера есть, и кнопка ПОСЕРЕДИНЕ пустого экрана, когда их нет. То
          есть одно действие в двух местах и двух видах, и ни одно из них не
          там, где человек его ищет. Футер стоит ВСЕГДА — список пуст или нет,
          место действия не переезжает.

          Без календаря в адресе звать некуда: приглашение всегда в календарь. */}
      {teamId ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 }}>
          <GradientButton label="Добавить мастера" onPress={() => setInviteOpen(true)} />
        </View>
      ) : null}

      {teamId ? (
        <InviteMemberSheet
          visible={inviteOpen}
          teamId={teamId}
          teamName={teamName}
          onClose={() => setInviteOpen(false)}
        />
      ) : null}
    </Screen>
  );
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase("ru-RU").replace(/ё/g, "е");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function MasterRow({
  master,
  tint,
  onPress,
}: {
  master: Master;
  tint: string;
  onPress: () => void;
}) {
  const t = useThemeColors();
  const archived = !master.is_active;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${master.full_name || "Мастер"}${archived ? ", в архиве" : ""}`}
      className="flex-row items-center px-4 py-3 active:opacity-60"
    >
      <View
        className="mr-3 h-10 w-10 items-center justify-center rounded-full"
        style={{ backgroundColor: archived ? t.faint : tint }}
      >
        <Text
          style={{
            fontSize: 14,
            fontWeight: "700",
            color: readableForeground(archived ? t.faint : tint),
          }}
        >
          {getInitials(master.full_name)}
        </Text>
      </View>
      <View className="flex-1">
        <Text
          style={{ fontSize: 16, fontWeight: "600", color: archived ? t.faint : t.ink }}
          numberOfLines={1}
        >
          {master.full_name || "Без имени"}
        </Text>
        {archived ? (
          <Text style={{ fontSize: 14, color: t.faint }} numberOfLines={1}>
            В архиве — открыть, чтобы вернуть
          </Text>
        ) : master.phone ? (
          <Text style={{ fontSize: 14, color: t.sub }} numberOfLines={1}>
            {master.phone}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
