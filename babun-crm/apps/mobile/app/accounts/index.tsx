import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeftRight, ChevronRight } from "lucide-react-native";
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
  KIND_ICON,
  KIND_TILE,
  accountsTotal,
} from "@/features/finances/account-ui";
import { Card } from "@/components/ui/Card";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { GradientButton } from "@/components/ui/GradientButton";
import { TeamChips } from "@/features/calendar/TeamChips";
import { EmptyState } from "@/components/ui/EmptyState";
import { Divider } from "@/components/ui/Divider";
import { ICON } from "@/components/ui/tokens";
import { useThemeColors } from "@/theme/colors";
import { useTeams } from "@/features/reference/queries";

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
  const balanceLabel = formatEUR(account.balance);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`${account.name}${subtitle ? `, ${subtitle}` : ""}, ${formatEUR(account.balance)}`}
      className="flex-row items-center gap-3 px-4 active:opacity-60"
      style={{ minHeight: 50 }}
    >
      {/* Плитка ровно как в строках настроек: 28×28, r14, белый значок на
          цвете — «зелёная = наличные» запоминается быстрее слова. */}
      <View
        className="h-7 w-7 items-center justify-center rounded-[14px]"
        style={{ backgroundColor: KIND_TILE[account.kind] }}
      >
        <Icon color="#fff" size={16} strokeWidth={2} />
      </View>
      <View className="min-w-0 flex-1">
        <Text
          className="text-[15px]"
          style={{ color: t.ink }}
          numberOfLines={1}
        >
          {account.name}
        </Text>
        {subtitle ? (
          <Text className="mt-px text-xs" style={{ color: t.faint }} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Text
        className="text-[15px] font-semibold tabular-nums"
        style={{ color: account.balance < 0 ? t.danger : t.ink }}
      >
        {balanceLabel}
      </Text>
      <ChevronRight color={t.chevron} size={18} strokeWidth={2.2} />
    </Pressable>
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
  // ОБЛАСТЬ ЭКРАНА — ОДНА КОМАНДА. Владелец 2026-08-10: «сверху поставь, чтобы
  // можно было чередовать; всего на счетах — только по одной, а не со всех».
  // Разбивка списком под итогом убрана: она отвечала на вопрос, которого не
  // задавали, и мешала прочитать главную цифру.
  const [scope, setScope] = useState<string>("company");
  useEffect(() => {
    // Первый заход открывает первую команду, а не счета компании: деньги
    // бригад смотрят каждый день, компанейские — раз в месяц.
    if (scope === "company" && teams.length > 0) setScope(teams[0].id);
    // Только на первый приезд списка команд.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teams.length]);

  const chipTeams = useMemo(
    () => [
      ...teams.map((team) => ({ id: team.id, name: team.name, color: team.color })),
      { id: "company", name: "Компания", color: null },
    ],
    [teams],
  );

  const scopeAccounts = useMemo(
    () =>
      scope === "company"
        ? companyAccounts
        : accounts.filter((a) => a.scope === "team" && a.brigade_id === scope),
    [scope, accounts, companyAccounts],
  );
  const total = useMemo(() => accountsTotal(scopeAccounts), [scopeAccounts]);

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

  // isPending, не isLoading: офлайн-paused запрос иначе рисовал «Нет
  // счетов» с кнопкой добавления вместо честной загрузки/ошибки.
  const loading =
    accountsQuery.isPending || teamsQuery.isPending || allTeamsQuery.isPending;
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
                  {i > 0 ? <Divider inset={56} /> : null}
                  <AccountRow
                    account={a}
                    subtitle={
                      a.scope === "company"
                        ? `Общий · ${a.team_ids.length} ${teamsWord(a.team_ids.length)}`
                        : a.brigade_id
                          ? (teamById.get(a.brigade_id)?.name ?? "Без бригады")
                          : "Без бригады"
                    }
                    // История закрытого счёта остаётся смотрибельной:
                    // тап — деталь, long-press — быстрая реанимация.
                    onPress={() => router.push(`/accounts/${a.id}`)}
                    onLongPress={() => confirmReopen(a)}
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
      <ScreenHeader
        title={title}
        right={
          hasTransferPair(accounts) ? (
            <Pressable
              onPress={() => openTransfer()}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Перевод между счетами"
              className="h-10 w-10 items-center justify-center active:opacity-60"
            >
              <ArrowLeftRight color={t.accent} size={ICON.md} />
            </Pressable>
          ) : undefined
        }
      />
      {/* КОМАНДЫ СВЕРХУ, КАК В ФИНАНСАХ И КАЛЕНДАРЕ. Плюс «Компания» —
          счета, которые не принадлежат бригаде (расчётный, общий банк). */}
      <TeamChips
        teams={chipTeams}
        activeId={scope}
        onSelect={setScope}
      />

      {accounts.length === 0 && closed.length === 0 ? (
        <EmptyState
          fill
          title="Нет счетов"
          subtitle="Касса или карта бригады — деньги операций живут на счетах"
          action={{ label: "Добавить счёт", onPress: openCreate }}
        />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {/* Одна цифра — по выбранной наверху команде. */}
          <Card style={{ marginHorizontal: 12, marginTop: 8, padding: 16 }}>
            <Text className="text-xs" style={{ color: t.sub }}>
              Всего на счетах
            </Text>
            <Text
              className="mt-0.5 text-2xl font-bold tabular-nums"
              style={{ color: t.brandAccent }}
            >
              {formatEUR(total)}
            </Text>
          </Card>

          {scopeAccounts.length === 0 ? (
            <Text
              className="mx-4 mt-6 text-center text-[15px]"
              style={{ color: t.faint }}
            >
              {scope === "company"
                ? "У компании пока нет счетов"
                : "У этой команды пока нет счетов"}
            </Text>
          ) : (
            <Card style={{ marginHorizontal: 12, marginTop: 8 }}>
              {scopeAccounts.map((a, i) => (
                <View key={a.id}>
                  {i > 0 ? <Divider inset={56} /> : null}
                  <AccountRow
                    account={a}
                    subtitle={
                      a.scope === "company"
                        ? `${a.team_ids.length} ${teamsWord(a.team_ids.length)}`
                        : undefined
                    }
                    onPress={() => router.push(`/accounts/${a.id}`)}
                    onLongPress={() => confirmClose(a)}
                  />
                </View>
              ))}
            </Card>
          )}

          {closed.length > 0 ? (
            <Pressable
              onPress={() => router.push("/accounts?archived=1")}
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

      {/* Одна подписанная кнопка внизу — ровно там же, где «Добавить клиента»
          и «Добавить операцию». Две строки в карточке внизу списка владельцу
          не нравились и выпадали из языка продукта. */}
      <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 }}>
        <GradientButton label="Добавить счёт" onPress={openCreate} />
      </View>

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
  return <AccountsListContent />;
}
