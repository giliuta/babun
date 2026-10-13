import type { useGuardedClose } from "@/components/ui/use-guarded-close";
import type { useThemeColors } from "@/theme/colors";
import type { AccountWithBalance } from "../accounts";
import type { TransferGroup } from "../transfer-options";
import type { useTransferDraft } from "./use-transfer-draft";

/** Everything a step of the transfer sheet draws from. The steps are render
 *  helpers, not components: every step returns the same `BottomSheet`
 *  element, so switching steps keeps the one open sheet, as before the split. */
export type TransferView = ReturnType<typeof useTransferDraft> & {
  t: ReturnType<typeof useThemeColors>;
  visible: boolean;
  guard: ReturnType<typeof useGuardedClose>;
  title: string;
  businessToday: string;
  currency: string | undefined;
  dateFloor: string;
  groups: TransferGroup<AccountWithBalance>[];
  spansTeams: boolean;
  label: (account: AccountWithBalance) => string;
  reason: string | null;
  canSend: boolean;
  amountNum: number;
  send: () => Promise<void>;
};
