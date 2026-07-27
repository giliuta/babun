import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronRight, EyeOff, Wallet } from "lucide-react-native";
import { formatEURExact as formatEUR } from "@babun/shared/common/utils/money";
import { Card } from "@/components/ui/Card";
import { useThemeColors } from "@/theme/colors";
import type { AccountWithBalance } from "./accounts";
import {
  HIDDEN_BALANCE_LABEL,
  KIND_ICON,
  visibleAccountsTotal,
} from "./account-ui";

function countWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "счетов";
  if (mod10 === 1) return "счёт";
  if (mod10 >= 2 && mod10 <= 4) return "счёта";
  return "счетов";
}

// «Счета» inline panel (LOCKED v5: tapping the Счета mini-card swaps the
// content below — NOT a popup and NOT a route jump). Two sections now:
// the scope's own team accounts and attached company («Общие») accounts.
// A company account shows its FULL balance (splitting it into team shares
// would lie); in team scope the secondary line shows the team's period
// inflow instead — the honest per-team number. Transfers and account CRUD
// live on the cabinet screen — the footer row leads there.
export function AccountsPanel({
  accounts,
  isLoading,
  scopeTeamId,
  periodInflowByAccount,
}: {
  accounts: AccountWithBalance[];
  isLoading?: boolean;
  /** Активный командный скоуп страницы (null = «Компания»). */
  scopeTeamId?: string | null;
  /** Приток за выбранный период по счетам активного скоупа (income − |refund|). */
  periodInflowByAccount?: Map<string, number>;
}) {
  const t = useThemeColors();
  const router = useRouter();
  // Тап по скрытой сумме — транзиентный показ до ухода с панели.
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const { total, hasHidden } = visibleAccountsTotal(accounts);

  const teamAccounts = accounts.filter((a) => a.scope === "team");
  const companyAccounts = accounts.filter((a) => a.scope === "company");

  const renderRow = (a: AccountWithBalance, i: number) => {
    const Icon = KIND_ICON[a.kind] ?? Wallet;
    const hidden = a.balance_hidden && !revealed.has(a.id);
    const inflow =
      scopeTeamId && a.scope === "company"
        ? periodInflowByAccount?.get(a.id)
        : undefined;
    return (
      <Pressable
        key={a.id}
        onPress={() => router.push(`/cabinet/accounts/${a.id}`)}
        accessibilityRole="button"
        accessibilityLabel={`${a.name}, ${
          hidden ? "баланс скрыт" : formatEUR(a.balance)
        }`}
        className="px-4 active:opacity-60"
        style={{
          minHeight: 48,
          justifyContent: "center",
          paddingVertical: 6,
          borderTopWidth: i > 0 ? 1 : 0,
          borderTopColor: t.separator,
        }}
      >
        <View className="flex-row items-center gap-3">
          <Icon color={t.sub} size={18} />
          <Text
            className="flex-1 text-[15px] font-medium"
            style={{ color: t.ink }}
            numberOfLines={1}
          >
            {a.name}
          </Text>
          {/* Тап по скрытой сумме — транзиентный показ, НЕ переход. */}
          {a.balance_hidden ? (
            <Pressable
              onPress={() =>
                setRevealed((prev) => {
                  const next = new Set(prev);
                  if (next.has(a.id)) next.delete(a.id);
                  else next.add(a.id);
                  return next;
                })
              }
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={hidden ? "Показать баланс" : "Скрыть баланс"}
            >
              <Text
                className="text-[15px] font-semibold tabular-nums"
                style={{ color: !hidden && a.balance < 0 ? t.danger : t.ink }}
              >
                {hidden ? HIDDEN_BALANCE_LABEL : formatEUR(a.balance)}
              </Text>
            </Pressable>
          ) : (
            <Text
              className="text-[15px] font-semibold tabular-nums"
              style={{ color: a.balance < 0 ? t.danger : t.ink }}
            >
              {formatEUR(a.balance)}
            </Text>
          )}
          <ChevronRight color={t.chevron} size={14} />
        </View>
        {inflow !== undefined ? (
          <Text
            className="mt-0.5 text-xs tabular-nums"
            style={{ color: t.sub, paddingLeft: 30 }}
          >
            С этой команды за период · {inflow >= 0 ? "+" : "−"}
            {formatEUR(Math.abs(inflow))}
          </Text>
        ) : null}
      </Pressable>
    );
  };

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 96 }}>
      <View className="flex-row items-baseline justify-between px-4 pb-1 pt-2">
        <Text
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: t.sub }}
        >
          {accounts.length} {countWord(accounts.length)}
        </Text>
        <View className="flex-row items-center gap-1">
          {hasHidden ? <EyeOff color={t.faint} size={12} /> : null}
          <Text
            className="text-xs font-semibold tabular-nums"
            style={{ color: t.sub }}
          >
            {formatEUR(total)}
          </Text>
        </View>
      </View>

      <Card style={{ marginHorizontal: 12 }}>
        {isLoading ? (
          <Text className="px-4 py-6 text-center text-xs" style={{ color: t.faint }}>
            Загрузка…
          </Text>
        ) : accounts.length === 0 ? (
          <Text className="px-4 py-6 text-center text-xs" style={{ color: t.faint }}>
            У команды пока нет счетов
          </Text>
        ) : (
          <>
            {teamAccounts.map(renderRow)}
            {companyAccounts.length > 0 ? (
              <>
                <View
                  className="px-4 pb-1"
                  style={{
                    paddingTop: 10,
                    borderTopWidth: teamAccounts.length > 0 ? 1 : 0,
                    borderTopColor: t.separator,
                  }}
                >
                  <Text
                    className="text-[11px] font-bold uppercase tracking-wider"
                    style={{ color: t.sub }}
                  >
                    Общие счета
                  </Text>
                </View>
                {companyAccounts.map(renderRow)}
              </>
            ) : null}
          </>
        )}

        {/* transfers + CRUD live on the cabinet accounts screen */}
        <Pressable
          onPress={() => router.push("/cabinet/accounts")}
          accessibilityRole="button"
          accessibilityLabel="Все счета и перевод"
          className="flex-row items-center px-4 active:opacity-60"
          style={{
            minHeight: 48,
            borderTopWidth: accounts.length > 0 || isLoading ? 1 : 0,
            borderTopColor: t.separator,
          }}
        >
          <Text className="text-[15px] font-medium" style={{ color: t.accent }}>
            Все счета · Перевод
          </Text>
          <View className="ml-auto">
            <ChevronRight color={t.chevron} size={16} />
          </View>
        </Pressable>
      </Card>
    </ScrollView>
  );
}
