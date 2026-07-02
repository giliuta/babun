import { Pressable, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  Banknote,
  ChevronRight,
  CreditCard,
  Landmark,
  Wallet,
  type LucideIcon,
} from "lucide-react-native";
import { formatEUR } from "@babun/shared/common/utils/money";
import type { AccountKind } from "@babun/shared/local/finance/account";
import { Card } from "@/components/ui/Card";
import { useThemeColors } from "@/theme/colors";
import type { AccountWithBalance } from "./accounts";

const KIND_ICON: Record<AccountKind, LucideIcon> = {
  cash: Banknote,
  card: CreditCard,
  bank: Landmark,
  other: Wallet,
};

function countWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "счетов";
  if (mod10 === 1) return "счёт";
  if (mod10 >= 2 && mod10 <= 4) return "счёта";
  return "счетов";
}

// «Счета» inline panel (LOCKED v5: tapping the Счета mini-card swaps the
// content below — NOT a popup and NOT a route jump). Strictly scoped to
// the active team: flat rows (icon + name + balance), no team tag.
// Transfers and account CRUD live on the cabinet screen — the footer row
// leads there instead of duplicating those sheets.
export function AccountsPanel({
  accounts,
  isLoading,
}: {
  accounts: AccountWithBalance[];
  isLoading?: boolean;
}) {
  const t = useThemeColors();
  const router = useRouter();
  const total = accounts.reduce((s, a) => s + a.balance, 0);

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 96 }}>
      <View className="flex-row items-baseline justify-between px-4 pb-1 pt-2">
        <Text
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: t.sub }}
        >
          {accounts.length} {countWord(accounts.length)}
        </Text>
        <Text
          className="text-xs font-semibold tabular-nums"
          style={{ color: t.sub }}
        >
          {formatEUR(total)}
        </Text>
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
          accounts.map((a, i) => {
            const Icon = KIND_ICON[a.kind] ?? Wallet;
            return (
              <View
                key={a.id}
                className="flex-row items-center gap-3 px-4"
                style={{
                  minHeight: 48,
                  borderTopWidth: i > 0 ? 1 : 0,
                  borderTopColor: t.separator,
                }}
              >
                <Icon color={t.sub} size={18} />
                <Text
                  className="flex-1 text-[15px] font-medium"
                  style={{ color: t.ink }}
                  numberOfLines={1}
                >
                  {a.name}
                </Text>
                <Text
                  className="text-[15px] font-semibold tabular-nums"
                  style={{ color: a.balance < 0 ? t.danger : t.ink }}
                >
                  {formatEUR(a.balance)}
                </Text>
              </View>
            );
          })
        )}

        {/* transfers + CRUD live on the cabinet accounts screen */}
        <Pressable
          onPress={() => router.push("/cabinet/accounts")}
          accessibilityRole="button"
          accessibilityLabel="Управление счетами"
          className="flex-row items-center px-4 active:opacity-60"
          style={{
            minHeight: 48,
            borderTopWidth: accounts.length > 0 || isLoading ? 1 : 0,
            borderTopColor: t.separator,
          }}
        >
          <Text className="text-[15px] font-medium" style={{ color: t.accent }}>
            Перевод · Новый счёт
          </Text>
          <View className="ml-auto">
            <ChevronRight color={t.chevron} size={16} />
          </View>
        </Pressable>
      </Card>
    </ScrollView>
  );
}
