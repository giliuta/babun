import { Crown } from "lucide-react-native";
import { useToast } from "@/components/ui/Toast";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { useTransferOwnership } from "@/features/cabinet/company-actions";
import type { ActionMenuItem } from "@/features/calendar/ActionMenuSheet";
import { useAccountKind } from "@/features/settings/my-accounts";
import { useCurrentRole } from "@/features/settings/tenant";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import { useTenantId } from "@/lib/tenant";

// «ПЕРЕДАТЬ ВЛАДЕНИЕ» — в шторке действий партнёра (владелец 11.10: «компания
// живёт без основателя: владение можно передать»). Только владельцу и только
// в компании: Личное не передаётся. Прежний владелец остаётся партнёром со
// всеми правами (`transfer_company_ownership`).
export function useTransferOwnershipItem(member: { userId: string; name: string } | null, onDone: () => void): ActionMenuItem | null {
  const role = useCurrentRole().data;
  const tenantId = useTenantId();
  const kind = useAccountKind(tenantId);
  const transfer = useTransferOwnership();
  const toast = useToast();
  if (!member || !tenantId || role !== "owner" || kind !== "company") return null;
  return {
    label: "Передать владение",
    icon: Crown,
    color: SETTINGS_TILE.blue,
    run: () =>
      confirmThen(
        `Передать владение — ${member.name}?`,
        {
          message:
            "Владельцем компании станет этот человек: он платит за тариф, удаляет компанию и передаёт её дальше. Вы останетесь партнёром со всеми правами.",
          confirmLabel: "Передать",
        },
        () =>
          transfer.mutate(
            { tenantId, userId: member.userId },
            {
              onSuccess: () => {
                toast(`Владелец компании — ${member.name}`, "success");
                onDone();
              },
              onError: (e) => notify("Не удалось передать владение", e.message),
            },
          ),
      ),
  };
}
