import { useMirror } from "@/session/mirror-state";
import { useMyAccess } from "@/session/access-queries";
import { useCurrentRole } from "@/session/tenant";
import { useMyCalendars } from "@/session/workspaces";
import { paymentRights, type PaymentRights } from "./payment-rights";

// Хуки живут отдельно от правила: `payment-rights.ts` обязан оставаться
// чистым, иначе его не поднять тестовым раннером (он тянул бы react-native).

/** Те же права, собранные из хуков экрана. */
export function usePaymentRights(teamId: string | null): PaymentRights {
  const role = useCurrentRole().data;
  const map = useMyAccess().data;
  const myCalendars = useMyCalendars().data ?? [];
  const mirror = useMirror();
  return paymentRights({ role, map, teamId, myCalendars, mirror: mirror?.map ?? null });
}
