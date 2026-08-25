import { useMemo } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  BarChart3,
  CalendarDays,
  ChevronRight,
  Info,
  MoreVertical,
  Phone,
  ShieldCheck,
} from "lucide-react-native";
import {
  ACCOUNT_STATUS_LABELS,
  PERMISSION_GROUPS,
  getInitials,
  type AccountStatus,
  type MasterPermissions,
} from "@babun/shared/local/masters";
import { getRecognizedRevenue } from "@babun/shared/local/appointments";
import { telUrl, whatsappUrl } from "@babun/shared/common/utils/messenger-links";
import { formatEUR } from "@babun/shared/common/utils/money";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Divider } from "@/components/ui/Divider";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { readableForeground } from "@/theme/readable-color";
import {
  useDeleteMaster,
  useMaster,
  useRemoveMasterFromTeams,
  useTeams,
  useUpdateMaster,
  type Team,
} from "@/features/reference/queries";
import {
  getMasterContacts,
  getMasterPermissions,
  getMasterProfile,
} from "@/features/reference/master-profile";
import { useAppointments } from "@/features/calendar/queries";
import { notify } from "@/lib/notify";
import { confirmThen } from "@/lib/confirm";
import { chooseOption } from "@/lib/choose";

// Хаб мастера (nav-хаб, порт web masters/[id]/page.tsx). Собирает вокруг
// одного мастера: шапку с аватаром/kebab, профиль-карточку, плашки команд,
// nav на подэкраны (Информация/Доступы/Визиты/Статистика), тумблер active и
// мини-статы «За этот месяц» (считаются на лету из appointments).

// helper_ids приходит из Supabase как Json — узкое приведение к string[].
function teamHelperIds(t: Team): string[] {
  return Array.isArray(t.helper_ids)
    ? (t.helper_ids as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
}
function teamLeadIds(t: Team): string[] {
  const arr = Array.isArray(t.lead_ids)
    ? (t.lead_ids as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  if (arr.length > 0) return Array.from(new Set(arr));
  return t.lead_id ? [t.lead_id] : [];
}

export default function MasterHubScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useThemeColors();
  const router = useRouter();
  const masterQuery = useMaster(id);
  const teamsQuery = useTeams();
  const { data: master } = masterQuery;
  const teams = useMemo(() => teamsQuery.data ?? [], [teamsQuery.data]);
  // Полный список (включая архивные) — только для delete-свипа: web parity,
  // handleDelete чистит master.id из ВСЕХ команд, иначе мастер-призрак
  // воскресает в составе при повторной активации архивной команды.
  const allTeamsQuery = useTeams({ includeInactive: true });
  const appointmentsQuery = useAppointments();
  const allTeams = allTeamsQuery.data ?? [];
  const appointments = useMemo(
    () => appointmentsQuery.data ?? [],
    [appointmentsQuery.data],
  );
  const update = useUpdateMaster();
  const del = useDeleteMaster();
  const removeFromTeams = useRemoveMasterFromTeams();

  // Команды мастера — объединение основной team_id и всех команд, где он в
  // lead_ids/helper_ids. Первая — источник тинта аватара (web parity).
  const assignedTeams = useMemo<Team[]>(() => {
    if (!master) return [];
    const seen = new Map<string, Team>();
    if (master.team_id) {
      const primary = teams.find((x) => x.id === master.team_id);
      if (primary) seen.set(primary.id, primary);
    }
    for (const team of teams) {
      if (
        teamLeadIds(team).includes(master.id) ||
        teamHelperIds(team).includes(master.id)
      ) {
        if (!seen.has(team.id)) seen.set(team.id, team);
      }
    }
    return Array.from(seen.values());
  }, [master, teams]);

  const primaryTeam = assignedTeams[0] ?? null;
  const tint = primaryTeam?.color ?? t.faint;

  // Превью «Доступы»: N из M включено (та же формула, что на вебе — по всем
  // PERMISSION_GROUPS поверх resolved-прав c mergePermissions).
  const accessPreview = useMemo(() => {
    if (!master) return "";
    const perms: MasterPermissions = getMasterPermissions(master);
    let on = 0;
    let total = 0;
    for (const g of PERMISSION_GROUPS) {
      for (const p of g.permissions) {
        total += 1;
        if (perms[p as keyof MasterPermissions]) on += 1;
      }
    }
    return `${on} из ${total} включено`;
  }, [master]);

  // Мини-статы за текущий месяц по всем командам мастера (на лету, кэш не
  // нужен): всего / закрыто / выручка по completed без полных возвратов.
  const perf = useMemo(() => {
    if (!master || assignedTeams.length === 0) {
      return { total: 0, completed: 0, cancelled: 0, revenue: 0 };
    }
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const teamIds = new Set(assignedTeams.map((x) => x.id));
    let total = 0;
    let completed = 0;
    let cancelled = 0;
    let revenue = 0;
    for (const a of appointments) {
      if (!a.team_id || !teamIds.has(a.team_id)) continue;
      if (!a.date.startsWith(ym)) continue;
      total += 1;
      if (a.status === "completed") {
        completed += 1;
        revenue += getRecognizedRevenue(a);
      } else if (a.status === "cancelled") {
        cancelled += 1;
      }
    }
    return { total, completed, cancelled, revenue };
  }, [master, assignedTeams, appointments]);

  const loading =
    masterQuery.isLoading ||
    teamsQuery.isLoading ||
    allTeamsQuery.isLoading ||
    appointmentsQuery.isLoading;
  const readError =
    masterQuery.error ||
    teamsQuery.error ||
    allTeamsQuery.error ||
    appointmentsQuery.error;

  if (loading) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Мастер" />
        <EmptyState state="loading" fill />
      </Screen>
    );
  }

  if (readError) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Мастер" />
        <EmptyState
          state="error"
          title="Не удалось загрузить мастера"
          subtitle={readError instanceof Error ? readError.message : undefined}
          action={{
            label: "Повторить",
            onPress: () =>
              void Promise.all([
                masterQuery.refetch(),
                teamsQuery.refetch(),
                allTeamsQuery.refetch(),
                appointmentsQuery.refetch(),
              ]),
          }}
          fill
        />
      </Screen>
    );
  }

  if (!master) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Мастер" />
        <EmptyState
          fill
          title="Мастер не найден"
          action={{ label: "К списку", onPress: () => router.replace("/cabinet/masters") }}
        />
      </Screen>
    );
  }

  const contacts = getMasterContacts(master);
  const profile = getMasterProfile(master);
  const status = master.account_status as AccountStatus | null;

  const tel = telUrl(contacts.phone);
  const wa = whatsappUrl(profile.whatsapp || contacts.phone);

  const onContact = () => {
    // «Отмена» рисует сам лист выбора — в список её больше не кладём.
    const ways: { label: string; open: () => void }[] = [];
    if (tel) ways.push({ label: "Позвонить", open: () => void Linking.openURL(tel) });
    if (wa) ways.push({ label: "WhatsApp", open: () => void Linking.openURL(wa) });
    if (ways.length === 0) {
      notify("Нет контактов", "У мастера не указан телефон.");
      return;
    }
    void chooseOption(
      master.full_name || "Мастер",
      ways.map((w) => ({ label: w.label })),
      { message: contacts.phone || undefined },
    ).then((index) => {
      if (index !== null) ways[index].open();
    });
  };

  const onMenu = () => {
    const archiveLabel = master.is_active ? "Архивировать" : "Вернуть из архива";
    void chooseOption(master.full_name || "Мастер", [
      { label: archiveLabel },
      { label: "Удалить", destructive: true },
    ]).then((index) => {
      if (index === 0) {
        update.mutate(
          { id: master.id, patch: { is_active: !master.is_active } },
          { onError: (e) => notify("Ошибка", (e as Error).message) },
        );
      } else if (index === 1) {
        onDelete();
      }
    });
  };

  const onDelete = () => {
    const teamPart =
      assignedTeams.length > 0
        ? `Состоит в ${assignedTeams.length} ${pluralTeams(assignedTeams.length)}. `
        : "";
    confirmThen(
      `Удалить «${master.full_name}»?`,
      {
        message: `${teamPart}Отменить нельзя.`,
        confirmLabel: "Удалить",
        destructive: true,
      },
      () =>
        del.mutate(master.id, {
          // web parity: после soft-delete вычистить master.id из
          // members / lead_ids / helper_ids всех команд (включая
          // архивные — allTeams), чтобы веб-финансы/расписание не
          // ссылались на удалённого мастера.
          onSuccess: () =>
            removeFromTeams.mutate(
              { masterId: master.id, teams: allTeams },
              {
                onError: (e) =>
                  notify("Ошибка", (e as Error).message),
                onSettled: () => router.replace("/cabinet/masters"),
              },
            ),
          onError: (e) => notify("Ошибка", (e as Error).message),
        }),
    );
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader
        title={master.full_name || "Мастер"}
        right={
          <Pressable
            onPress={onMenu}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Действия"
            style={({ pressed }) => ({
              height: 44,
              width: 44,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 999,
              backgroundColor: pressed ? t.pressed : "transparent",
            })}
          >
            <MoreVertical color={t.sub} size={ICON.md} />
          </Pressable>
        }
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Профиль-карточка: аватар + имя + title + «Связаться». */}
        <View className="mx-3 mt-3">
          <Card>
            <View className="items-center gap-2 px-4 py-5">
              <View
                className="h-20 w-20 items-center justify-center rounded-full"
                style={{ backgroundColor: tint }}
              >
                <Text
                  style={{
                    fontSize: 24,
                    fontWeight: "700",
                    color: readableForeground(tint),
                  }}
                >
                  {getInitials(master.full_name)}
                </Text>
              </View>
              <Text
                style={{ fontSize: 18, fontWeight: "700", color: t.ink, textAlign: "center" }}
              >
                {master.full_name || "Мастер"}
              </Text>
              {master.title ? (
                <Text style={{ fontSize: 13, color: t.sub, textAlign: "center", marginTop: -4 }}>
                  {master.title}
                </Text>
              ) : null}
              <Pressable
                onPress={onContact}
                hitSlop={4}
                accessibilityRole="button"
                accessibilityLabel="Связаться"
                className="mt-1 h-9 flex-row items-center gap-1.5 rounded-full px-4 active:opacity-70"
                style={{ backgroundColor: t.fill }}
              >
                <Phone color={t.accent} size={ICON.sm} />
                <Text style={{ fontSize: 13, fontWeight: "600", color: t.accent }}>
                  {contacts.phone || "Связаться"}
                </Text>
              </Pressable>
            </View>
          </Card>
        </View>

        {/* В командах — read-only chips, тап → хаб команды. */}
        {assignedTeams.length > 0 ? (
          <View className="mx-3 mt-4">
            <Text
              style={{
                fontSize: 11,
                fontWeight: "700",
                letterSpacing: 0.6,
                textTransform: "uppercase",
                color: t.faint,
                marginBottom: 6,
                marginLeft: 4,
              }}
            >
              В командах
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {assignedTeams.map((team) => (
                <Pressable
                  key={team.id}
                  onPress={() => router.push(`/cabinet/teams/${team.id}`)}
                  hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Открыть команду ${team.name}`}
                  className="h-8 flex-row items-center gap-1.5 rounded-full px-3 active:opacity-70"
                  style={{ backgroundColor: t.surface, boxShadow: t.cardShadow }}
                >
                  <View
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: team.color ?? t.faint }}
                  />
                  <Text style={{ fontSize: 13, fontWeight: "600", color: t.ink }}>
                    {team.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {/* Nav-строки. */}
        <View className="mx-3 mt-4">
          <Card>
            <NavRow
              icon={<Info color={t.onAccent} size={ICON.sm} />}
              tone="#2f6fd6"
              title="Информация"
              value={infoPreview(contacts, profile.whatsapp, profile.telegram, contacts.email, status)}
              onPress={() => router.push(`/cabinet/masters/${master.id}/info`)}
            />
            <Divider inset={60} />
            <NavRow
              icon={<ShieldCheck color={t.onAccent} size={ICON.sm} />}
              tone="#c9372c"
              title="Доступы"
              value={accessPreview}
              onPress={() => router.push(`/cabinet/masters/${master.id}/access`)}
            />
            <Divider inset={60} />
            <NavRow
              icon={<CalendarDays color={t.onAccent} size={ICON.sm} />}
              tone="#4b55c7"
              title="Визиты"
              value={
                perf.total > 0
                  ? `${perf.total} ${pluralVisits(perf.total)} в этом месяце`
                  : "нет визитов в этом месяце"
              }
              onPress={() => router.push(`/cabinet/masters/${master.id}/visits`)}
            />
            <Divider inset={60} />
            <NavRow
              icon={<BarChart3 color={t.onAccent} size={ICON.sm} />}
              tone="#087a52"
              title="Статистика"
              value={
                perf.completed > 0
                  ? `${perf.completed} закрыто · ${formatEUR(perf.revenue)}`
                  : "пока без данных"
              }
              onPress={() => router.push(`/cabinet/masters/${master.id}/stats`)}
            />
          </Card>
        </View>

        {/* Тумблер «Мастер активен». */}
        <View className="mx-3 mt-4">
          <Card>
            <View className="flex-row items-center gap-3 px-4 py-3">
              <View className="flex-1">
                <Text style={{ fontSize: 15, color: t.ink }}>Мастер активен</Text>
                <Text style={{ fontSize: 12, color: t.faint, marginTop: 2 }}>
                  {master.is_active
                    ? "Виден в календаре и выборе команды."
                    : "В архиве — можно вернуть в любой момент."}
                </Text>
              </View>
              <Switch
                value={master.is_active}
                onValueChange={(next) =>
                  update.mutate(
                    { id: master.id, patch: { is_active: next } },
                    { onError: (e) => notify("Ошибка", (e as Error).message) },
                  )
                }
                trackColor={{ true: t.accent, false: t.disabledFill }}
              />
            </View>
          </Card>
        </View>

        {/* Мини-сводка «За этот месяц» → тап уводит на статистику. */}
        {assignedTeams.length > 0 ? (
          <View className="mx-3 mt-4">
            <Pressable
              onPress={() => router.push(`/cabinet/masters/${master.id}/stats`)}
              accessibilityRole="button"
              accessibilityLabel="Открыть статистику за этот месяц"
              className="active:opacity-80"
            >
              <Card>
                <View className="px-4 py-3">
                  <View className="mb-2 flex-row items-center justify-between">
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: "700",
                        letterSpacing: 0.6,
                        textTransform: "uppercase",
                        color: t.faint,
                      }}
                    >
                      За этот месяц
                    </Text>
                    <ChevronRight color={t.chevron} size={ICON.sm} />
                  </View>
                  <View className="flex-row gap-2">
                    <PerfTile label="Визитов" value={String(perf.total)} />
                    <PerfTile label="Закрыто" value={String(perf.completed)} />
                    <PerfTile label="Выручка" value={formatEUR(perf.revenue)} />
                  </View>
                  {perf.cancelled > 0 ? (
                    <Text style={{ fontSize: 11, color: t.faint, marginTop: 8 }}>
                      Отменённых: {perf.cancelled}.
                    </Text>
                  ) : null}
                </View>
              </Card>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function infoPreview(
  contacts: { phone: string; email?: string },
  whatsapp: string | undefined,
  telegram: string | undefined,
  email: string | undefined,
  status: AccountStatus | null,
): string {
  const parts: string[] = [];
  parts.push(contacts.phone || "телефон не указан");
  const bits: string[] = [];
  if (whatsapp) bits.push("WhatsApp");
  if (telegram) bits.push("Telegram");
  if (email) bits.push("email");
  if (bits.length > 0) parts.push(bits.join(", "));
  if (status && ACCOUNT_STATUS_LABELS[status]) {
    parts.push(ACCOUNT_STATUS_LABELS[status].toLowerCase());
  }
  return parts.join(" · ");
}

function PerfTile({ label, value }: { label: string; value: string }) {
  const t = useThemeColors();
  return (
    <View className="flex-1 rounded-[10px] px-2 py-2" style={{ backgroundColor: t.fill }}>
      <Text style={{ fontSize: 18, fontWeight: "700", color: t.ink }}>{value}</Text>
      <Text
        style={{
          fontSize: 11,
          color: t.faint,
          textTransform: "uppercase",
          letterSpacing: 0.3,
          marginTop: 2,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

function NavRow({
  icon,
  tone,
  title,
  value,
  onPress,
}: {
  icon: React.ReactNode;
  tone: string;
  title: string;
  value: string;
  onPress: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      className="flex-row items-center gap-3 px-4 py-3 active:opacity-70"
      style={{ minHeight: 56 }}
    >
      <View
        className="h-8 w-8 items-center justify-center rounded-[10px]"
        style={{ backgroundColor: tone }}
      >
        {icon}
      </View>
      <View className="flex-1">
        <Text style={{ fontSize: 15, fontWeight: "500", color: t.ink }} numberOfLines={1}>
          {title}
        </Text>
        {value ? (
          <Text style={{ fontSize: 13, color: t.sub, marginTop: 2 }} numberOfLines={1}>
            {value}
          </Text>
        ) : null}
      </View>
      <ChevronRight color={t.chevron} size={ICON.sm} />
    </Pressable>
  );
}

function pluralVisits(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "визит";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "визита";
  return "визитов";
}

function pluralTeams(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "команде";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "командах";
  return "командах";
}
