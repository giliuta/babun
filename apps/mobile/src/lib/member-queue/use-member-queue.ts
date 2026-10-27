import { useEffect, useState } from "react";
import { listMemberOps, type MemberQueuedOp } from "@babun/shared/db/cache/sql";
import { subscribeQueueChange } from "@babun/shared/sync";

const POLL_MS = 5_000;

/** Правки сотрудника, ждущие отправки, — этой компании. Очередь одна на
 *  телефон, а «Синхронизация» показывает только открытую компанию. Обновляется
 *  по событию очереди и страховочным опросом, как счётчик владельца. */
export function useMemberQueue(tenantId: string | null): MemberQueuedOp[] {
  const [ops, setOps] = useState<MemberQueuedOp[]>([]);
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const all = await listMemberOps();
        if (!cancelled) setOps(all.filter((op) => op.tenant_id === tenantId));
      } catch {
        // локальной базы нет (веб, до загрузки) — очереди тоже нет
      }
    };
    void refresh();
    const unsub = subscribeQueueChange(() => void refresh());
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => {
      cancelled = true;
      unsub();
      clearInterval(id);
    };
  }, [tenantId]);
  return ops;
}
