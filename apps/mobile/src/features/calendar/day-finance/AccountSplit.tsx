import type { Dispatch, SetStateAction } from "react";
import { View } from "react-native";
import { Wallet } from "lucide-react-native";
import { formatEURExact as formatEUR } from "@babun/shared/common/utils/money";
import type { Account } from "@babun/shared/local/finance/account";
import { RowGroupHeader } from "@/components/ui/card-rows";
import { PaymentTile, TILE_GAP } from "@/features/appointments/PaymentTiles";
import type { moneyByAccount } from "@/features/calendar/day-money";
import { accountIcon } from "@/features/finances/account-ui";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/theme/colors";
import type { DayView } from "./types";

// ПО СЧЕТАМ — под «Доходом» и «Расходом»: сколько легло на каждый
// счёт команды за день, плиткой счёта, какой его узнают в оплате
// записи. Тап — строки только этого счёта.
export function AccountSplit({
  view,
  split,
  accountById,
  accountPick,
  setAccountPick,
  splitTileW,
}: {
  view: DayView;
  split: ReturnType<typeof moneyByAccount>;
  accountById: Map<string, Account>;
  accountPick: string | null | undefined;
  setAccountPick: Dispatch<SetStateAction<string | null | undefined>>;
  splitTileW: number;
}) {
  const t = useThemeColors();
  return (
    <View style={{ paddingTop: 14 }}>
      <RowGroupHeader title="По счетам" />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: TILE_GAP, paddingHorizontal: 16 }}>
        {split.map((entry) => {
          const account = entry.accountId ? accountById.get(entry.accountId) : undefined;
          const label = account?.name ?? "Без счёта";
          const zero = entry.amount === 0;
          const sign = view === "expense" && !zero ? "−" : "";
          const selected = accountPick !== undefined && accountPick === entry.accountId;
          return (
            <PaymentTile
              key={entry.accountId ?? "none"}
              icon={account ? accountIcon(account) : Wallet}
              label={label}
              color={account?.color ?? t.ink}
              tint={account?.color ?? null}
              width={splitTileW}
              compact
              state="idle"
              selected={selected}
              amount={`${sign}${formatEUR(Math.abs(entry.amount))}`}
              amountColor={zero ? t.faint : view === "expense" ? t.danger : t.success}
              disabled={entry.count === 0}
              onPress={() => {
                haptics.tap();
                setAccountPick((cur) => (cur === entry.accountId ? undefined : entry.accountId));
              }}
              accessibilityLabel={`${label}: ${view === "expense" ? "ушло" : "пришло"} ${formatEUR(Math.abs(entry.amount))}${selected ? ", выбран" : ""}`}
            />
          );
        })}
      </View>
    </View>
  );
}
