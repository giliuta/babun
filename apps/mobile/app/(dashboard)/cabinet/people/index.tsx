import { useMemo, useState } from "react";
import { FlatList, TextInput, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { Search } from "lucide-react-native";
import { getInitials } from "@babun/shared/local/masters";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Divider } from "@/components/ui/Divider";
import { GradientButton } from "@/components/ui/GradientButton";
import { usePartnersAccess } from "@/session/use-partner-manager";
import { useThemeColors } from "@/theme/colors";
import { useMasters, useTeams, type Master } from "@/features/reference/queries";
import { useDataRole } from "@/session/tenant";
import { usePendingInvitations } from "@/features/settings/team-access";
import { canAddPartner } from "@/session/tiers";
import { useTariff, useTariffNudge } from "@/features/tariffs/use-tariff";
import { refusalOf } from "@/session/access-map";
import { calendarCards } from "@/features/access/masters-list";
import { openMasterDraft } from "@/features/access/master-page/draft-store";
import {
  invitationSegment,
} from "@/features/access/master-page/master-draft";
import { PendingInvitationRow, PersonRow } from "@/features/access/PeopleRows";
import { MemberListRow } from "@/features/access/MemberListRow";
import {
  AccessRequestError,
  useCompanyMembers,
  type CalendarMember,
} from "@/session/access-queries";

// СОТРУДНИКИ КОМПАНИИ — «Кабинет → Сотрудники». Список один на
// компанию, под именем — его команды; права по командам — на странице
// человека (иначе один человек стоял бы в двух местах — в каждом календаре).
// Сверху люди с доступом и приглашения без ответа, ниже карточки мастеров
// без аккаунта.
//
// «ДОБАВИТЬ МАСТЕРА» — СРАЗУ ПОЛНАЯ КАРТОЧКА НОВОГО МАСТЕРА (как добавление
// клиента), приглашение по почте уходит из неё кнопкой «Пригласить». Шторки приглашения на этом экране больше нет: одна дверь к
// одному действию. Тап по приглашению без ответа открывает ту же карточку.
type PendingInvitation = NonNullable<ReturnType<typeof usePendingInvitations>["data"]>[number];

type MastersRow =
  | { kind: "member"; key: string; member: CalendarMember }
  | { kind: "invite"; key: string; invitation: PendingInvitation }
  | { kind: "card"; key: string; master: Master };

export default function MastersScreen() {
  const t = useThemeColors();
  const router = useRouter();
  // Приглашает владелец — и директор с правом «Партнёры: Управляет»;
  // остальным сервер откажет.
  const isOwner = usePartnersAccess().manages;
  // Включая архивных: «Вернуть из архива» живёт в хабе мастера, и без
  // архивного хвоста в списке он недостижим. Активные
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
  const teamsQuery = useTeams({ display: true });
  const teams = useMemo(() => teamsQuery.data ?? [], [teamsQuery.data]);

  const [search, setSearch] = useState("");

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

  // ЛЮДИ КОМПАНИИ С ДОСТУПОМ (STORY-081): сотрудник — аккаунт, прикреплённый к
  // календарям, а не карточка по имени и телефону.
  const membersQuery = useCompanyMembers();
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
  // КАРТОЧКА ПРИГЛАШЁННОГО — НЕ ВТОРАЯ СТРОКА ТОГО ЖЕ ЧЕЛОВЕКА. Мастеру,
  // принявшему приглашение, сервер заводит карточку (`invited_master_gets_card`),
  // а сам он уже стоит строкой «С доступом к календарю»: карточка ниже
  // повторила бы его вторым рядом.
  const staffIds = useMemo(() => new Set(staff.map((member) => member.userId)), [staff]);
  // Все карточки компании, кроме тех, чей человек уже стоит строкой выше.
  // ПАРТНЁР КАРТОЧЕК НЕ ВИДИТ (иначе он сам стоял бы в «Партнёрах» дважды). Ему мастера приходят из
  // `list_operational_masters_safe` без `user_id`, и свою же карточку
  // приглашённого не отличить от строки человека. Карточка без аккаунта —
  // дело владельца (все — партнёры с аккаунтом).
  const dataRole = useDataRole().data;
  const cards = useMemo(
    () =>
      dataRole === "owner"
        ? calendarCards(masters, { teamId: undefined, teams, staffUserIds: staffIds })
        : [],
    [dataRole, masters, teams, staffIds],
  );
  // Отказ «людей видит владелец» — не беда: раздела просто нет. Любая другая
  // ошибка называется вслух, иначе пустой список соврёт «Нет мастеров».
  const membersFailed =
    membersQuery.isError &&
    !(membersQuery.error instanceof AccessRequestError && refusalOf(membersQuery.error) === "not_owner");

  // ПРИГЛАШЕНИЯ БЕЗ ОТВЕТА. Без них «Пригласить» уходило бы в пустоту: ни
  // следа на экране, ни способа отправить ссылку ещё раз.
  const invitationsQuery = usePendingInvitations();
  const calendarInvitations = useMemo(() => invitationsQuery.data ?? [], [invitationsQuery.data]);
  const pending = useMemo(() => {
    const needle = normalizeSearch(search);
    if (!needle) return calendarInvitations;
    return calendarInvitations.filter((inv) => normalizeSearch(inv.email).includes(needle));
  }, [calendarInvitations, search]);

  const tariff = useTariff();
  const nudgeTariff = useTariffNudge();

  const hasAnyone = allMasters.length > 0 || staff.length > 0 || calendarInvitations.length > 0;

  // ОДИН СПИСОК МАСТЕРОВ КАЛЕНДАРЯ, БЕЗ ПЛАШЕК. Подписи «С доступом к календарю»,
  // «Ждут ответа», «Карточки мастеров» показывали бы устройство базы, а не
  // команду. Поэтому один ряд: кто
  // работает, кого позвали (строка сама говорит «ждёт ответа»), старые
  // карточки — в том же ряду и тем же видом.
  const rows = useMemo<MastersRow[]>(
    () => [
      ...members.map((member): MastersRow => ({
        kind: "member",
        key: `member:${member.userId}`,
        member,
      })),
      ...pending.map((invitation): MastersRow => ({
        kind: "invite",
        key: `invite:${invitation.id}`,
        invitation,
      })),
      ...cards.map((master): MastersRow => ({ kind: "card", key: `card:${master.id}`, master })),
    ],
    [members, pending, cards],
  );

  // Тинт аватара по первой команде человека (цвет команды), как на вебе.
  const teamColorById = useMemo(() => {
    const m = new Map<string, string>();
    for (const team of teams) if (team.color) m.set(team.id, team.color);
    return m;
  }, [teams]);

  return (
    <Screen edges={["top"]}>
      {/* Шестерёнки с шаблонами доступа нет. */}
      <ScreenHeader title="Партнёры" />

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
          data={rows}
          keyExtractor={(row) => row.key}
          contentContainerStyle={{ flexGrow: 1 }}
          ListHeaderComponent={
            <>
              {hasAnyone ? (
                <View
                  className="mx-4 mb-2 mt-2 h-11 flex-row items-center rounded-[10px] px-3"
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
              {membersFailed ? (
                <EmptyState
                  state="error"
                  title="Не удалось загрузить людей с доступом"
                  action={{ label: "Повторить", onPress: () => void membersQuery.refetch() }}
                />
              ) : null}
            </>
          }
          renderItem={({ item }) => {
            if (item.kind === "member") {
              return (
                <MemberListRow
                  userId={item.member.userId}
                  name={item.member.name}
                  initials={getInitials(item.member.name)}
                  tint={teamColorById.get(item.member.calendars[0] ?? "") || t.faint}
                  teamIds={item.member.calendars}
                  onPress={() =>
                    router.push(`/cabinet/people/access/${item.member.userId}` as Href)
                  }
                />
              );
            }
            if (item.kind === "invite") {
              return (
                <PendingInvitationRow
                  invitation={item.invitation}
                  onPress={() =>
                    router.push(
                      `/cabinet/people/${invitationSegment(item.invitation.id)}` as Href,
                    )
                  }
                />
              );
            }
            const archived = !item.master.is_active;
            return (
              <PersonRow
                name={item.master.full_name || "Без имени"}
                initials={getInitials(item.master.full_name)}
                sub={archived ? "В архиве — открыть, чтобы вернуть" : item.master.phone || undefined}
                muted={archived}
                accessibilityLabel={`${item.master.full_name || "Мастер"}${archived ? ", в архиве" : ""}`}
                tint={
                  item.master.team_id
                    ? teamColorById.get(item.master.team_id) ?? t.faint
                    : t.faint
                }
                // ОДНА ДВЕРЬ (STORY-087): карточка с аккаунтом — сразу страница
                // сотрудника с правами, а не старый хаб без них.
                onPress={() =>
                  router.push(
                    (item.master.user_id
                      ? `/cabinet/people/access/${item.master.user_id}`
                      : `/cabinet/people/${item.master.id}`) as Href,
                  )
                }
              />
            );
          }}
          // Разделитель — от имени: поле 16 + аватар 40 + зазор 12.
          ItemSeparatorComponent={() => <Divider inset={68} />}
          ListEmptyComponent={
            membersFailed ? null : (
              <EmptyState
                fill
                title={search.trim() ? "Ничего не найдено" : "Партнёров пока нет"}
                subtitle={search.trim() ? "Измените имя, телефон или email в поиске." : undefined}
              />
            )
          }
        />
      )}

      {/* ГЛАВНОЕ ДЕЙСТВИЕ — ВНИЗУ ЭКРАНА. Тот же футер, что у списка клиентов:
          20 по бокам, 8 сверху, 10 снизу, `GradientButton` во всю ширину.

          ДВЕ РАЗНЫЕ ДВЕРИ (строка `AddRow` в конце списка и кнопка ПОСЕРЕДИНЕ
          пустого экрана) — одно действие в двух местах и видах, и ни одно не
          там, где человек его ищет. Футер стоит ВСЕГДА — список пуст или нет,
          место действия не переезжает.

          Команды нового сотрудника выбираются на его карточке. Приглашает
          только владелец: остальным кнопки нет. */}
      {isOwner ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 }}>
          <GradientButton
            label="Пригласить партнёра"
            // ЛИМИТ ТАРИФА: Про — до 5 партнёров, Макс — до 50; люди и
            // ждущие приглашения. Сверх — кнопка серая, тап поднимает плашку.
            disabled={!canAddPartner(tariff.state.tier, staff.length + new Set(calendarInvitations.map((inv) => inv.email.toLowerCase())).size)}
            onDisabledPress={nudgeTariff}
            onPress={() => {
              openMasterDraft(null);
              router.push("/cabinet/people/new" as Href);
            }}
          />
        </View>
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
