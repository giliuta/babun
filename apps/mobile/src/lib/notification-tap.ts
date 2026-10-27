import { getActiveTenantId } from "@/lib/active-tenant";
import { queryClient } from "@/lib/query-client";

// ТАП ПО УВЕДОМЛЕНИЮ О ЗАПИСИ — СНАЧАЛА СВЕЖИЕ ЗАПИСИ.
//
// Календарь ищет запись из уведомления в уже загруженном списке. У мастера
// живого канала нет (он только у владельца и диспетчера), поэтому без
// перечитывания новая работа из пуша не находилась бы — «Заявка не найдена» —
// а перенесённая открылась бы со старым временем.
//
// Перечитывается только активный аккаунт: обёртка запроса ходит с заголовком
// текущего аккаунта, и чужой ключ получил бы его записи. Ждём не дольше
// пяти секунд — без сети календарь откроется тем, что есть.

const REFRESH_LIMIT_MS = 5000;

export function refreshAppointmentsForTap(): Promise<void> {
  const tenantId = getActiveTenantId();
  if (!tenantId) return Promise.resolve();
  return Promise.race([
    queryClient
      .refetchQueries({ queryKey: ["appointments", tenantId], type: "all" })
      .then(
        () => undefined,
        () => undefined,
      ),
    new Promise<void>((resolve) => setTimeout(resolve, REFRESH_LIMIT_MS)),
  ]);
}
