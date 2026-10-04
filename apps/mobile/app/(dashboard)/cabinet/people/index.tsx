import { useMemo, useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { Search } from "lucide-react-native";
import { getInitials } from "@babun/shared/local/masters";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Divider } from "@/components/ui/Divider";
import { GradientButton } from "@/components/ui/GradientButton";
import { usePartnersAccess } from "@/features/access/master-page/use-partner-manager";
import { useThemeColors } from "@/theme/colors";
import { readableForeground } from "@/theme/readable-color";
import { useMasters, useTeams, type Master } from "@/features/reference/queries";
import { useDataRole } from "@/features/settings/tenant";
import { usePendingInvitations } from "@/features/settings/team-access";
import { canAddPartner } from "@/features/tariffs/tiers";
import { useTariff, useTariffNudge } from "@/features/tariffs/use-tariff";
import { refusalOf } from "@/features/access/access-map";
import { calendarCards } from "@/features/access/masters-list";
import { openMasterDraft } from "@/features/access/master-page/draft-store";
import {
  invitationSegment,
} from "@/features/access/master-page/master-draft";
import { MemberRow, PendingInvitationRow } from "@/features/access/PeopleRows";
import {
  AccessRequestError,
  useCompanyMembers,
  type CalendarMember,
} from "@/features/access/queries";

// СОТРУДНИКИ КОМПАНИИ — «Кабинет → Сотрудники» (владелец 29.09: «страницу
// мастера перенесём в кабинет… и полноценно на каждую команду, что он может
// делать»). Раньше это были «Мастера» каждого календаря: один человек стоял в
// двух местах, и права другой команды открывались выбором календарей на его
// странице. Теперь список один на компанию, под именем — его команды; права
// по командам — на странице человека. Сверху люди с доступом и приглашения
// без ответа, ниже карточки мастеров без аккаунта.
//
// «ДОБАВИТЬ МАСТЕРА» — СРАЗУ ПОЛНАЯ КАРТОЧКА НОВОГО МАСТЕРА (владелец 15.09:
// «как добавление клиента»), приглашение по почте уходит из неё кнопкой
// «Пригласить». Шторки приглашения на этом экране больше нет: одна дверь к
// одному действию. Тап по приглашению без ответа открывает ту же карточку.
type PendingInvitation = NonNullable<ReturnType<typeof usePendingInvitations>["data"]>[number];

type MastersRow =
  | { kind: "member"; key: string; member: CalendarMember }
  | { kind: "invite"; key: string; invitation: PendingInvitation }
  | { kind: "card"; key: string; master: Master };

export default function MastersScreen() {
  const t = useThemeColors();
  const router = useRouter();
  // Приглашает владелец — и директор с правом «Партнёры: Управляет» (04.10);
  // остальным сервер откажет (аудит 24.09).
  const isOwner = usePartnersAccess().manages;
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
  // КАРТОЧКА ПРИГЛАШЁННОГО — НЕ ВТОРАЯ СТРОКА ТОГО ЖЕ ЧЕЛОВЕКА (15.09). Мастеру,
  // принявшему приглашение, сервер заводит карточку (`invited_master_gets_card`),
  // а сам он уже стоит строкой «С доступом к календарю»: карточка ниже
  // повторила бы его вторым рядом.
  const staffIds = useMemo(() => new Set(staff.map((member) => member.userId)), [staff]);
  // Все карточки компании, кроме тех, чей человек уже стоит строкой выше.
  // ПАРТНЁР КАРТОЧЕК НЕ ВИДИТ (прогон 04.10: у Дмитрия в «Партнёрах» Giliuta
  // он сам стоял дважды). Ему мастера приходят из
  // `list_operational_masters_safe` без `user_id`, и свою же карточку
  // приглашённого не отличить от строки человека. Карточка без аккаунта —
  // дело владельца (все — партнёры с аккаунтом, владелец 01.10).
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

  // ОДИН СПИСОК МАСТЕРОВ КАЛЕНДАРЯ, БЕЗ ПЛАШЕК (владелец 15.09: «не нравится
  // „С доступом к календарю", вот эта плашка»). Экран делился тремя подписями —
  // «С доступом к календарю», «Ждут ответа», «Карточки мастеров», — и человек
  // читал устройство базы, а не свою команду. Теперь это один ряд: кто
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
  // Под именем — его команды («Команда 1, Команда 3»): по ним и открываются
  // права на его странице.
  const teamNames = (ids: readonly string[]) =>
    ids
      .map((id) => teams.find((team) => team.id === id)?.name)
      .filter((name): name is string => !!name)
      .join(", ");

  return (
    <Screen edges={["top"]}>
      {/* Шестерёнки с шаблонами доступа больше нет (владелец 30.09: «по
          сути вот эти шаблоны» не нужны). */}
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
                <MemberRow
                  member={item.member}
                  tint={teamColorById.get(item.member.calendars[0] ?? "") || t.faint}
                  sub={teamNames(item.member.calendars) || "Без команды"}
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
            return (
              <MasterRow
                master={item.master}
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
          ItemSeparatorComponent={() => <Divider inset={64} />}
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

      {/* ГЛАВНОЕ ДЕЙСТВИЕ — ВНИЗУ ЭКРАНА (владелец 2026-09-10: «кнопка должна
          быть внизу, как и всё у нас»). Тот же футер, что у списка клиентов:
          20 по бокам, 8 сверху, 10 снизу, `GradientButton` во всю ширину.

          ЗДЕСЬ БЫЛО ДВЕ РАЗНЫХ ДВЕРИ: строка `AddRow` в конце списка, когда
          мастера есть, и кнопка ПОСЕРЕДИНЕ пустого экрана, когда их нет. То
          есть одно действие в двух местах и двух видах, и ни одно из них не
          там, где человек его ищет. Футер стоит ВСЕГДА — список пуст или нет,
          место действия не переезжает.

          Команды нового сотрудника выбираются на его карточке. Приглашает
          только владелец: остальным кнопки нет (аудит 24.09). */}
      {isOwner ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 }}>
          <GradientButton
            label="Пригласить партнёра"
            // ЛИМИТ ТАРИФА (01.10): Про — до 5 партнёров, Макс — до 50; люди и
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
