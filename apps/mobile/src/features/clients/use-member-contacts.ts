import { useCallback, useRef, useState } from "react";
import type { Client } from "@babun/shared/local/clients";
import { useToast } from "@/components/ui/Toast";
import { useClientsScopeOrNull } from "@/features/clients/company-scope";
import { useMirror } from "@/features/access/mirror/mirror-state";
import { memberClientContacts } from "@/features/clients/queries";
import { rememberContacts } from "@/features/clients/revealed-contacts";
import { haptics } from "@/lib/haptics";
import { supabase } from "@/lib/supabase";
import { tenantBoundClient } from "@/lib/tenant-bound-client";
import { useTenantId } from "@/lib/tenant";

// Открыть номер одного клиента — по тапу сотрудника (правила двери —
// `member-contacts.ts`). Открытое ложится в память (`revealed-contacts.ts`),
// карточка перерисовывается с номером; отказ говорится одной строкой.

export function useOpenMemberContacts() {
  const toast = useToast();
  const scope = useClientsScopeOrNull();
  const activeTenantId = useTenantId();
  const tenantId = scope?.tenantId ?? activeTenantId;
  const [busy, setBusy] = useState(false);
  // «Посмотреть его глазами»: запись из зеркала запрещена, а дверь номера
  // пишет журнал — не зовём её и говорим, почему.
  const mirrored = useMirror() !== null;
  // Двойной тап не тратит лимит дважды: второй ждёт первого.
  const inFlight = useRef(false);

  const open = useCallback(
    async (client: Pick<Client, "id">): Promise<boolean> => {
      if (!tenantId || inFlight.current) return false;
      if (mirrored) {
        toast("В просмотре номер не открывается", "info");
        return false;
      }
      inFlight.current = true;
      setBusy(true);
      try {
        const db = scope && !scope.isActive ? tenantBoundClient(tenantId) : supabase;
        const answer = await memberClientContacts(db, client.id);
        if (answer.status === "open") {
          rememberContacts(tenantId, client.id, answer.contacts);
          haptics.tap();
          return true;
        }
        haptics.warning();
        toast(
          answer.status === "day"
            ? "Номер откроется в день записи"
            : answer.status === "limit"
              ? "На сегодня номеров больше не открыть"
              : "Нет доступа к телефонам",
          "info",
        );
        return false;
      } catch {
        haptics.warning();
        toast("Не удалось открыть номер — проверьте соединение", "error");
        return false;
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [scope, tenantId, toast, mirrored],
  );

  return { open, busy };
}
