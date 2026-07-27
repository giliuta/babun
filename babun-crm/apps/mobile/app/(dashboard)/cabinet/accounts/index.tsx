import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeftRight, ChevronRight, EyeOff } from "lucide-react-native";
import { formatEURExact as formatEUR } from "@babun/shared/common/utils/money";
import type { AccountWithBalance } from "@/features/finances/accounts";
import {
  useAccountsWithBalances,
  useReopenAccount,
  useSoftCloseAccount,
} from "@/features/finances/accounts";
import { AccountCreateSheet } from "@/features/finances/AccountCreateSheet";
import { TransferSheet } from "@/features/finances/TransferSheet";
import {
  HIDDEN_BALANCE_LABEL,
  KIND_ICON,
  visibleAccountsTotal,
} from "@/features/finances/account-ui";
import { Card } from "@/components/ui/Card";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Divider } from "@/components/ui/Divider";
import { AddRow } from "@/components/ui/AddRow";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { useTeams, type Team } from "@/features/reference/queries";
import { RoleCapabilityBoundary } from "@/features/settings/RoleCapabilityBoundary";

function teamsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "команд";
  if (mod10 === 1) return "команда";
  if (mod10 >= 2 && mod10 <= 4) return "команды";
  return "команд";
}

// Пара для перевода существует, если это не два командных счёта разных
// бригад (правило §7.1 — межкомандные деньги идут через счёт компании).
function hasTransferPair(accounts: AccountWithBalance[]): boolean {
  return accounts.some((a, i) =>
    accounts
      .slice(i + 1)
      .some(
        (b) =>
          !(a.scope === "team" && b.scope === "team" && a.brigade_id !== b.brigade_id),
      ),
  );
}

// Строка счёта: тайл вида 32pt → имя → баланс (или ••••) → шеврон.
function AccountRow({
  account,
  subtitle,
  onPress,
  onLongPress,
}: {
  account: AccountWithBalance;
  subtitle?: string;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const t = useThemeColors();
  const Icon = KIND_ICON[account.kind];
  const balanceLabel = account.balance_hidden
    ? HIDDEN_BALANCE_LABEL
    : formatEUR(account.balance);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`${account.name}${subtitle ? `, ${subtitle}` : ""}, ${
        account.balance_hidden ? "баланс скрыт" : formatEUR(account.balance)
      }`}
      className="flex-row items-center gap-3 px-4 active:opacity-60"
      style={{ minHeight: 56 }}
    >
      <View
        className="items-center justify-center rounded-lg"
        style={{ width: 32, height: 32, backgroundColor: t.highlight }}
      >
        <Icon color={t.accent} size={ICON.sm} />
      </View>
      <View className="min-w-0 flex-1">
        <Text
          className="text-[17px] font-semibold"
          style={{ color: t.ink }}
          numberOfLines={1}
        >
          {account.name}
        </Text>
        {subtitle ? (
          <Text className="mt-0.5 text-xs" style={{ color: t.sub }} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Text
        className="text-[15px] font-semibold tabular-nums"
        style={{ color: account.balance < 0 && !account.balance_hidden ? t.danger : t.ink }}
      >
        {balanceLabel}
      </Text>
      <ChevronRight color={t.chevron} size={16} />
    </Pressable>
  );
}

// Ибровь секции команды: 6pt цветная точка + имя (том же кегле, что
// SectionEyebrow — вручную, из-за точки перед текстом).
function TeamEyebrow({ team, fallback }: { team?: Team; fallback: string }) {
  const t = useThemeColors();
  return (
    <View
      className="flex-row items-center gap-1.5"
      style={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 8 }}
    >
      <View
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: team?.color || t.faint,
        }}
      />
      <Text
        accessibilityRole="header"
        style={{
          fontSize: 11,
          fontWeight: "700",
          letterSpacing: 0.6,
          textTransform: "uppercase",
          color: t.sub,
        }}
      >
        {team?.name ?? fallback}
      </Text>
    </View>
  );
}

function AccountsListContent() {
  const t = useThemeColors();
  const router = useRouter();
  const params = useLocalSearchParams<{
    create?: string;
    brigadeId?: string;
    archived?: string;
  }>();
  const archived = params.archived === "1";

  const accountsQuery = useAccountsWithBalances({ includeInactive: true });
  // Активные — для чипов и чек-листа формы; ВСЕ (вкл. soft-deleted) — для
  // подписей: счёт живёт дольше своей команды.
  const teamsQuery = useTeams();
  const allTeamsQuery = useTeams({ includeInactive: true });
  const teams = useMemo(() => teamsQuery.data ?? [], [teamsQuery.data]);
  const allTeams = useMemo(() => allTeamsQuery.data ?? [], [allTeamsQuery.data]);
  const teamById = useMemo(
    () => new Map(allTeams.map((team) => [team.id, team])),
    [allTeams],
  );

  const all = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);
  const accounts = useMemo(() => all.filter((a) => a.is_active), [all]);
  const closed = useMemo(() => all.filter((a) => !a.is_active), [all]);

  const companyAccounts = useMemo(
    () => accounts.filter((a) => a.scope === "company"),
    [accounts],
  );
  // Секции по командам: порядок команд справочника, «осиротевшие» счета
  // (команда удалена) — последней группой.
  const teamSections = useMemo(() => {
    const byTeam = new Map<string, AccountWithBalance[]>();
    for (const a of accounts) {
      if (a.scope !== "team") continue;
      const key = a.brigade_id ?? "";
      const list = byTeam.get(key);
      if (list) list.push(a);
      else byTeam.set(key, [a]);
    }
    const orderedIds = [
      ...allTeams.map((team) => team.id).filter((id) => byTeam.has(id)),
      ...[...byTeam.keys()].filter((id) => !teamById.has(id)),
    ];
    return orderedIds.map((id) => ({
      teamId: id,
      team: teamById.get(id),
      accounts: byTeam.get(id) ?? [],
    }));
  }, [accounts, allTeams, teamById]);

  const { total, hasHidden } = useMemo(
    () => visibleAccountsTotal(accounts),
    [accounts],
  );

  const closeAcc = useSoftCloseAccount();
  const reopenAcc = useReopenAccount();

  const [createOpen, setCreateOpen] = useState(false);
  const [presetBrigadeId, setPresetBrigadeId] = useState<string | null>(null);
  const [presetName, setPresetName] = useState<string | undefined>(undefined);

  const [transferOpen, setTransferOpen] = useState(false);
  const [transferFromId, setTransferFromId] = useState<string | null>(null);
  const [transferAmount, setTransferAmount] = useState<number | null>(null);

  // Цепочка из «Команды»: teams.tsx после создания команды шлёт
  // ?create=1&brigadeId=… — открываем шит с предвыбранной бригадой и
  // дефолтным именем «Касса»: до готового счёта остаётся один тап.
  useEffect(() => {
    if (params.create === "1") {
      setPresetBrigadeId(params.brigadeId || null);
      setPresetName("Касса");
      setCreateOpen(true);
      router.setParams({ create: undefined, brigadeId: undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.create, params.brigadeId]);

  const openCreate = () => {
    setPresetBrigadeId(teams.length === 1 ? teams[0].id : null);
    setPresetName(undefined);
    setCreateOpen(true);
  };
  const openTransfer = (fromId?: string, amount?: number) => {
    setTransferFromId(fromId ?? null);
    setTransferAmount(amount ?? null);
    setTransferOpen(true);
  };

  const confirmClose = (a: AccountWithBalance) => {
    if (Math.abs(a.balance) >= 0.005) {
      const pairExists = accounts.some(
        (b) =>
          b.id !== a.id &&
          !(a.scope === "team" && b.scope === "team" && a.brigade_id !== b.brigade_id),
      );
      Alert.alert(
        "Сначала обнулите счёт",
        `${a.name}: остаток ${formatEUR(a.balance)}. Счёт с ненулевым балансом нельзя закрыть — история и общий остаток должны сходиться.`,
        [
          { text: "Понятно", style: "cancel" },
          ...(a.balance > 0 && pairExists
            ? [
                {
                  text: "Перевести остаток",
                  onPress: () => openTransfer(a.id, a.balance),
                },
              ]
            : []),
        ],
      );
      return;
    }
    Alert.alert("Закрыть счёт?", `${a.name} — история сохранится`, [
      { text: "Отмена", style: "cancel" },
      {
        text: "Закрыть",
        style: "destructive",
        onPress: () =>
          closeAcc.mutate(a.id, {
            onError: (e) => Alert.alert("Ошибка", e.message),
          }),
      },
    ]);
  };

  const confirmReopen = (a: AccountWithBalance) => {
    Alert.alert(a.name, "Счёт снова появится в списках и формах.", [
      { text: "Отмена", style: "cancel" },
      {
        text: "Открыть счёт снова",
        onPress: () =>
          reopenAcc.mutate(a.id, {
            onError: (e) => Alert.alert("Ошибка", e.message),
          }),
      },
    ]);
  };

  const loading =
    accountsQuery.isLoading || teamsQuery.isLoading || allTeamsQuery.isLoading;
  const loadError =
    (accountsQuery.data === undefined ? accountsQuery.error : null) ||
    (teamsQuery.data === undefined ? teamsQuery.error : null) ||
    (allTeamsQuery.data === undefined ? allTeamsQuery.error : null);
  const refreshAll = () =>
    void Promise.all([
      accountsQuery.refetch(),
      teamsQuery.refetch(),
      allTeamsQuery.refetch(),
    ]);

  const title = archived ? "Закрытые счета" : "Счета";

  if (loading) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title={title} />
        <EmptyState state="loading" fill />
      </Screen>
    );
  }

  if (loadError) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title={title} />
        <EmptyState
          state="error"
          fill
          title="Не удалось загрузить счета"
          subtitle={loadError instanceof Error ? loadError.message : undefined}
          action={{ label: "Повторить", onPress: refreshAll }}
        />
      </Screen>
    );
  }

  if (archived) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title={title} />
        {closed.length === 0 ? (
          <EmptyState
            fill
            title="Нет закрытых счетов"
            subtitle="Закрытый счёт сохраняет историю и может быть открыт снова"
          />
        ) : (
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
            <Card style={{ marginHorizontal: 12, marginTop: 12 }}>
              {closed.map((a, i) => (
                <View key={a.id}>
                  {i > 0 ? <Divider inset={68} /> : null}
                  <AccountRow
                    account={a}
                    subtitle={
                      a.scope === "company"
                        ? `Общий · ${a.team_ids.length} ${teamsWord(a.team_ids.length)}`
                        : a.brigade_id
                          ? (teamById.get(a.brigade_id)?.name ?? "Без бригады")
                          : "Без бригады"
                    }
                    onPress={() => confirmReopen(a)}
                  />
                </View>
              ))}
            </Card>
          </ScrollView>
        )}
      </Screen>
    );
  }

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title={title} />

      {accounts.length === 0 ? (
        <EmptyState
          fill
          title="Нет счетов"
          subtitle="Касса или карта бригады — деньги операций живут на счетах"
          action={{ label: "Добавить счёт", onPress: openCreate }}
        />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {/* Hero: Σ только видимых; EyeOff говорит, что число неполное. */}
          <Card style={{ marginHorizontal: 12, marginTop: 8, padding: 16 }}>
            <Text className="text-xs" style={{ color: t.sub }}>
              Всего на счетах
            </Text>
            <View className="flex-row items-center gap-1.5">
              <Text
                className="mt-0.5 text-2xl font-bold tabular-nums"
                style={{ color: t.brandAccent }}
              >
                {formatEUR(total)}
              </Text>
              {hasHidden ? <EyeOff color={t.faint} size={12} /> : null}
            </View>
          </Card>

          {companyAccounts.length > 0 ? (
            <>
              <SectionEyebrow>Компания</SectionEyebrow>
              <Card style={{ marginHorizontal: 12 }}>
                {companyAccounts.map((a, i) => (
                  <View key={a.id}>
                    {i > 0 ? <Divider inset={68} /> : null}
                    <AccountRow
                      account={a}
                      subtitle={`Общий · ${a.team_ids.length} ${teamsWord(a.team_ids.length)}`}
                      onPress={() => router.push(`/cabinet/accounts/${a.id}`)}
                      onLongPress={() => confirmClose(a)}
                    />
                  </View>
                ))}
              </Card>
            </>
          ) : null}

          {teamSections.map((section) => (
            <View key={section.teamId || "orphan"}>
              <TeamEyebrow team={section.team} fallback="Без бригады" />
              <Card style={{ marginHorizontal: 12 }}>
                {section.accounts.map((a, i) => (
                  <View key={a.id}>
                    {i > 0 ? <Divider inset={68} /> : null}
                    <AccountRow
                      account={a}
                      onPress={() => router.push(`/cabinet/accounts/${a.id}`)}
                      onLongPress={() => confirmClose(a)}
                    />
                  </View>
                ))}
              </Card>
            </View>
          ))}

          <View style={{ height: 16 }} />
          <Card style={{ marginHorizontal: 12 }}>
            {hasTransferPair(accounts) ? (
              <>
                <Pressable
                  onPress={() => openTransfer()}
                  accessibilityRole="button"
                  accessibilityLabel="Перевод между счетами"
                  className="flex-row items-center gap-3 px-4 active:opacity-60"
                  style={{ minHeight: 48 }}
                >
                  <ArrowLeftRight color={t.accent} size={ICON.sm} />
                  <Text className="text-[15px] font-medium" style={{ color: t.accent }}>
                    Перевод между счетами
                  </Text>
                </Pressable>
                <Divider inset={16} />
              </>
            ) : null}
            <AddRow label="Добавить счёт" onPress={openCreate} />
          </Card>

          {closed.length > 0 ? (
            <Pressable
              onPress={() => router.push("/cabinet/accounts?archived=1")}
              accessibilityRole="button"
              accessibilityLabel={`Закрытые счета: ${closed.length}`}
              className="mx-4 mt-4 flex-row items-center justify-between px-2 py-2 active:opacity-60"
            >
              <Text className="text-[13px] font-medium" style={{ color: t.sub }}>
                Закрытые счета · {closed.length}
              </Text>
              <ChevronRight color={t.chevron} size={14} />
            </Pressable>
          ) : null}
        </ScrollView>
      )}

      <AccountCreateSheet
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        teams={teams}
        presetBrigadeId={presetBrigadeId}
        presetName={presetName}
      />
      <TransferSheet
        visible={transferOpen}
        onClose={() => setTransferOpen(false)}
        accounts={accounts}
        teamById={teamById}
        presetFromId={transferFromId}
        presetAmount={transferAmount}
      />
    </Screen>
  );
}

export default function AccountsScreen() {
  return (
    <RoleCapabilityBoundary capability="view-finances" title="Счета">
      <AccountsListContent />
    </RoleCapabilityBoundary>
  );
}
