import { useMemo, useState } from "react";
import { ActionSheetIOS, Alert, Platform, ScrollView, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  formatEURExact as formatEUR,
  parseMoneyInputToCents,
} from "@babun/shared/common/utils/money";
import { AddRow } from "@/components/ui/AddRow";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { GradientButton } from "@/components/ui/GradientButton";
import { BottomSheet } from "@/components/ui/BottomSheet";
import {
  ActionRow,
  ChoiceRow,
  FieldRow,
  NavRow,
  RowCaption,
  RowGroup,
} from "@/components/ui/card-rows";
import { useTeams } from "@/features/reference/queries";
import {
  useAccountHasHistory,
  useAccountsWithBalances,
  useDeleteAccount,
  useReopenAccount,
  useSetAccountTeams,
  useSoftCloseAccount,
  useUpdateAccount,
} from "@/features/finances/accounts";
import { KINDS } from "@/features/finances/account-ui";
import { TeamChecklist } from "@/features/finances/TeamChecklist";
import { TransferSheet } from "@/features/finances/TransferSheet";
import { useVatSettings } from "@/features/finances/vat-queries";
import type { Account, AccountKind } from "@babun/shared/local/finance/account";

// НДС СЧЁТА ЧЕЛОВЕЧЕСКИМИ СЛОВАМИ. «Как в настройках» — это null, а не режим:
// счёт молчит, и решает команда или компания.
const ACCOUNT_VAT_OPTIONS = [
  "Как в настройках",
  "Без НДС",
  "НДС включён",
  "Плюс НДС",
] as const;

function accountVatLabel(mode: Account["vat_mode"]): string {
  if (mode === "off") return "Без НДС";
  if (mode === "inclusive") return "НДС включён";
  if (mode === "exclusive") return "Плюс НДС";
  return "Как в настройках";
}

function accountVatValue(label: string): Account["vat_mode"] {
  if (label === "Без НДС") return "off";
  if (label === "НДС включён") return "inclusive";
  if (label === "Плюс НДС") return "exclusive";
  return null;
}

// Кросс-платформенный ActionSheet: iOS — системный, остальное — Alert.
function pickSheet(
  title: string,
  options: { label: string; destructive?: boolean; onPress: () => void }[],
) {
  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        options: [...options.map((o) => o.label), "Отмена"],
        cancelButtonIndex: options.length,
        destructiveButtonIndex: options.findIndex((o) => o.destructive) >= 0
          ? options.findIndex((o) => o.destructive)
          : undefined,
      },
      (index) => {
        if (index < options.length) options[index].onPress();
      },
    );
    return;
  }
  Alert.alert(title, undefined, [
    ...options.map((o) => ({
      text: o.label,
      style: o.destructive ? ("destructive" as const) : undefined,
      onPress: o.onPress,
    })),
    { text: "Отмена", style: "cancel" as const },
  ]);
}

function AccountSettingsContent() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const accountsQuery = useAccountsWithBalances({ includeInactive: true });
  const accounts = useMemo(
    () => accountsQuery.data ?? [],
    [accountsQuery.data],
  );
  const account = accounts.find((a) => a.id === id) ?? null;
  const activeAccounts = useMemo(
    () => accounts.filter((a) => a.is_active),
    [accounts],
  );

  const teamsQuery = useTeams();
  const allTeamsQuery = useTeams({ includeInactive: true });
  const teams = useMemo(() => teamsQuery.data ?? [], [teamsQuery.data]);
  const teamById = useMemo(
    () => new Map((allTeamsQuery.data ?? []).map((team) => [team.id, team])),
    [allTeamsQuery.data],
  );

  const historyQuery = useAccountHasHistory(id ?? null);
  // Пока история не загрузилась — считаем, что она ЕСТЬ: безопаснее
  // придержать редактирование на долю секунды, чем разрешить лишнее.
  const hasHistory = historyQuery.data ?? true;

  const update = useUpdateAccount();
  const vatSettings = useVatSettings();
  const vatOn =
    (vatSettings.data?.mode ?? "off") !== "off" &&
    (vatSettings.data?.rate ?? 0) > 0;
  const setTeams = useSetAccountTeams();
  const closeAcc = useSoftCloseAccount();
  const reopenAcc = useReopenAccount();
  const deleteAcc = useDeleteAccount();

  const [attachOpen, setAttachOpen] = useState(false);
  const [attachSelected, setAttachSelected] = useState<Set<string>>(new Set());
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferAmount, setTransferAmount] = useState<number | null>(null);

  if (accountsQuery.isPending) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Настройки счёта" />
        <EmptyState state="loading" fill />
      </Screen>
    );
  }
  if (accountsQuery.data === undefined && accountsQuery.error) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Настройки счёта" />
        <EmptyState
          state="error"
          fill
          title="Не удалось загрузить счёт"
          action={{ label: "Повторить", onPress: () => void accountsQuery.refetch() }}
        />
      </Screen>
    );
  }
  if (!account) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Настройки счёта" />
        <EmptyState
          fill
          title="Счёт не найден"
          action={{ label: "К списку счетов", onPress: () => router.replace("/accounts") }}
        />
      </Screen>
    );
  }

  const alertError = (e: unknown) => Alert.alert("Ошибка", (e as Error).message);
  const kindLabel = KINDS.find((k) => k.value === account.kind)?.label ?? "";
  const attachedTeams = account.team_ids;
  const unattached = teams.filter((team) => !attachedTeams.includes(team.id));

  const frozenAlert = () =>
    Alert.alert(
      "Поле заморожено",
      "У счёта есть операции: вид, стартовый баланс и команда изменению не подлежат — история и остаток должны сходиться.",
    );

  const pickKind = () => {
    if (hasHistory) {
      frozenAlert();
      return;
    }
    pickSheet("Вид счёта", KINDS.map((k) => ({
      label: k.label,
      onPress: () =>
        update.mutate(
          { id: account.id, patch: { kind: k.value as AccountKind } },
          { onError: alertError },
        ),
    })));
  };

  const pickTeam = () => {
    if (hasHistory) {
      frozenAlert();
      return;
    }
    pickSheet("Команда счёта", teams.map((team) => ({
      label: team.name,
      onPress: () =>
        update.mutate(
          { id: account.id, patch: { brigade_id: team.id } },
          { onError: alertError },
        ),
    })));
  };

  const detachTeam = (teamId: string) => {
    const name = teamById.get(teamId)?.name ?? "команду";
    if (attachedTeams.length <= 1) {
      Alert.alert(
        "Последняя команда",
        "У общего счёта должна остаться хотя бы одна команда — иначе на него никто не сможет принимать оплату.",
      );
      return;
    }
    pickSheet(`${account.name} · ${name}`, [
      {
        label: "Отключить команду",
        destructive: true,
        onPress: () =>
          setTeams.mutate(
            {
              accountId: account.id,
              teamIds: attachedTeams.filter((x) => x !== teamId),
            },
            { onError: alertError },
          ),
      },
    ]);
  };

  const closeOrDelete = () => {
    if (!hasHistory) {
      Alert.alert("Удалить счёт?", `${account.name} — операций не было, счёт исчезнет навсегда.`, [
        { text: "Отмена", style: "cancel" },
        {
          text: "Удалить",
          style: "destructive",
          onPress: () =>
            deleteAcc.mutate(account.id, {
              // dismissTo схлопывает стек до списка: replace оставлял бы
              // деталь удалённого счёта в истории («назад» → «не найден»).
              onSuccess: () => router.dismissTo("/accounts"),
              onError: alertError,
            }),
        },
      ]);
      return;
    }
    if (Math.abs(account.balance) >= 0.005) {
      Alert.alert(
        "Сначала обнулите счёт",
        `${account.name}: остаток ${formatEUR(account.balance)}. Счёт с ненулевым балансом нельзя закрыть.`,
        [
          { text: "Понятно", style: "cancel" },
          ...(account.balance > 0 &&
          activeAccounts.some(
            (b) =>
              b.id !== account.id &&
              !(
                account.scope === "team" &&
                b.scope === "team" &&
                account.brigade_id !== b.brigade_id
              ),
          )
            ? [{
                text: "Перевести остаток",
                onPress: () => {
                  setTransferAmount(account.balance);
                  setTransferOpen(true);
                },
              }]
            : []),
        ],
      );
      return;
    }
    Alert.alert("Закрыть счёт?", `${account.name} — история сохранится`, [
      { text: "Отмена", style: "cancel" },
      {
        text: "Закрыть",
        style: "destructive",
        onPress: () =>
          closeAcc.mutate(account.id, {
            onSuccess: () => router.back(),
            onError: alertError,
          }),
      },
    ]);
  };

  return (
    <Screen edges={["top"]}>
      <ScreenHeader title="Настройки счёта" subtitle={account.name} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <RowGroup title="Основное">
          <FieldRow
            label="Название"
            value={account.name}
            placeholder="Название счёта"
            onSave={(next: string) => {
              const name = next.trim();
              if (!name || name === account.name) return;
              update.mutate({ id: account.id, patch: { name } }, { onError: alertError });
            }}
          />
          <NavRow
            label="Вид"
            value={kindLabel}
            separated
            dimmed={hasHistory}
            onPress={pickKind}
          />
          {hasHistory ? (
            <NavRow
              label="Стартовый баланс"
              value={formatEUR(account.opening_balance)}
              separated
              dimmed
              onPress={frozenAlert}
            />
          ) : (
            <FieldRow
              label="Стартовый баланс"
              value={String(account.opening_balance)}
              placeholder="0"
              separated
              tabular
              onSave={(next: string) => {
                if (!next.trim()) return; // очистили поле — не значит «ноль»
                const cents = parseMoneyInputToCents(next, {
                  allowNegative: true,
                  allowZero: true,
                });
                if (cents == null) {
                  Alert.alert(
                    "Проверьте баланс",
                    "Введите сумму и не больше двух знаков после запятой.",
                  );
                  return;
                }
                const num = cents / 100;
                if (num === account.opening_balance) return;
                update.mutate(
                  { id: account.id, patch: { opening_balance: num } },
                  { onError: alertError },
                );
              }}
            />
          )}
        </RowGroup>
        {hasHistory ? (
          <RowCaption text="Вид и стартовый баланс счёта с операциями изменить нельзя — история и остаток должны сходиться." />
        ) : null}

        <RowGroup title="Команды">
          {account.scope === "team" ? (
            <NavRow
              label="Команда"
              value={
                (account.brigade_id && teamById.get(account.brigade_id)?.name) ||
                "Без бригады"
              }
              dimmed={hasHistory}
              onPress={pickTeam}
            />
          ) : (
            <>
              {attachedTeams.map((teamId, i) => (
                <NavRow
                  key={teamId}
                  label={teamById.get(teamId)?.name ?? "Без бригады"}
                  separated={i > 0}
                  onPress={() => detachTeam(teamId)}
                />
              ))}
              {unattached.length > 0 ? (
                <AddRow
                  label="Подключить команду"
                  onPress={() => {
                    setAttachSelected(new Set());
                    setAttachOpen(true);
                  }}
                />
              ) : null}
            </>
          )}
        </RowGroup>
        {account.scope === "team" && hasHistory ? (
          <RowCaption text="Команду счёта с операциями сменить нельзя. Нужен общий доступ — создайте общий счёт и переведите остаток." />
        ) : null}
        {account.scope === "company" ? (
          <RowCaption text="Тап по команде — отключение. История отключённой команды сохраняется, новые операции с неё не принимаются." />
        ) : null}

        {/* НДС СЧЁТА. Владелец 2026-08-09: «есть счёт с НДС — понятное дело,
            что это счёт плюс НДС; можно устанавливать либо на самом счёте,
            либо в настройках финансов». На расчётный приходят деньги с
            налогом, в кассу от частника — без, и обе кассы у одной команды.
            Показываем только тем, кто с налогом работает. */}
        {vatOn ? (
          <>
            <RowGroup title="НДС">
              <ChoiceRow
                label="На этом счёте"
                options={ACCOUNT_VAT_OPTIONS}
                value={accountVatLabel(account.vat_mode)}
                onSelect={(label: string) =>
                  update.mutate(
                    { id: account.id, patch: { vat_mode: accountVatValue(label) } },
                    { onError: alertError },
                  )
                }
              />
            </RowGroup>
            <RowCaption text="Значение подставляется в новую операцию по этому счёту. В самой операции его всегда можно переключить." />
          </>
        ) : null}

        <RowGroup title="Архив">
          {account.is_active ? (
            <ActionRow
              label={hasHistory ? "Закрыть счёт" : "Удалить счёт"}
              tone="danger"
              onPress={closeOrDelete}
            />
          ) : (
            <ActionRow
              label="Открыть счёт снова"
              onPress={() =>
                reopenAcc.mutate(account.id, { onError: alertError })
              }
            />
          )}
        </RowGroup>
      </ScrollView>

      {/* Подключение команд — канонический лист с чек-листом. */}
      <BottomSheet visible={attachOpen} onClose={() => setAttachOpen(false)}>
        <View className="px-5 pb-2">
          <RowGroup title="Подключить команды">
            <View className="px-4">
              <TeamChecklist
                teams={unattached}
                selected={attachSelected}
                onToggle={(teamId) =>
                  setAttachSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(teamId)) next.delete(teamId);
                    else next.add(teamId);
                    return next;
                  })
                }
              />
            </View>
          </RowGroup>
          <View style={{ height: 12 }} />
          <GradientButton
            label="Подключить"
            disabled={attachSelected.size === 0 || setTeams.isPending}
            loading={setTeams.isPending}
            onPress={() =>
              setTeams.mutate(
                {
                  accountId: account.id,
                  teamIds: [...attachedTeams, ...attachSelected],
                },
                {
                  onSuccess: () => setAttachOpen(false),
                  onError: alertError,
                },
              )
            }
          />
        </View>
      </BottomSheet>

      <TransferSheet
        visible={transferOpen}
        onClose={() => setTransferOpen(false)}
        accounts={activeAccounts}
        teamById={teamById}
        presetFromId={account.id}
        presetAmount={transferAmount}
      />
    </Screen>
  );
}

export default function AccountSettingsScreen() {
  return <AccountSettingsContent />;
}
