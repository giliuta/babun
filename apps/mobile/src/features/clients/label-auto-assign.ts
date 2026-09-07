import type { QueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@babun/shared/db/database.types";
import type { Client } from "@babun/shared/local/clients";
import {
  CITY_CLEARED,
  resolveDayLabel,
  type DayCityMap,
} from "@babun/shared/local/day-cities";
import { fetchDayCity } from "@babun/shared/db/repositories/day-cities";
import {
  listClients as listClientsCached,
  updateClient,
} from "@babun/shared/sync/clientsCached";
import { isOnline } from "@babun/shared/sync";
import type { UserRole } from "@/features/settings/tenant";
import { dayCitiesQueryKey } from "@/features/calendar/day-cities";
import { clientsQueryKey } from "./queries";

// Метка дня → метка клиента («Тихий лист 2», решение владельца
// 2026-07-22). Best-effort вызов из onSuccess создания/переноса записи:
// рабочая запись в день с ЯВНОЙ меткой (day_cities) переносит её на
// клиента, пока метку не выбрали вручную (city_manual).
//
// Правила (зафиксированы):
// - default_city команды — НЕ фолбэк (только явная метка дня);
// - отмена/удаление записи метку с клиента не снимает;
// - смена метки дня задним числом клиентов не переписывает — пишут
//   только события записи;
// - ручной выбор в пикере ставит city_manual, «Убрать метку» сбрасывает
//   его (возврат в авто-режим).

export async function autoAssignClientLabel(opts: {
  supabase: SupabaseClient<Database>;
  qc: QueryClient;
  tenantId: string;
  role: UserRole;
  clientId: string;
  teamId: string | null;
  date: string;
  /** Метка САМОЙ записи (2026-09-04). Есть — она и переезжает на клиента:
   *  день в Лимассоле, а этого клиента возили в Пафос, и клиент должен
   *  запомнить Пафос. Нет — работает прежнее правило метки дня. */
  city?: string | null;
}): Promise<void> {
  const { supabase, qc, tenantId, role, clientId, teamId, date } = opts;
  if (!teamId) return;
  const own = (opts.city ?? "").trim();
  try {
    // Метка дня: тёплый кэш календаря отвечает и оффлайн; холодный кэш —
    // точечное чтение одной строки (только онлайн).
    const map = qc.getQueryData<DayCityMap>(dayCitiesQueryKey(tenantId, role));
    let label: string | null;
    if (own) {
      label = own;
    } else if (map) {
      label = resolveDayLabel(map, teamId, date);
    } else {
      if (!isOnline()) return;
      const raw = ((await fetchDayCity(supabase, tenantId, teamId, date)) ?? "").trim();
      label = raw === "" || raw === CITY_CLEARED ? null : raw;
    }
    if (!label) return;

    // Клиент: сперва кэш списка, иначе SQLite-кэш (работает и оффлайн).
    const list = qc.getQueryData<Client[]>(clientsQueryKey(tenantId, role));
    const client =
      list?.find((c) => c.id === clientId) ??
      (await listClientsCached(supabase, tenantId)).find(
        (c) => c.id === clientId,
      );
    if (!client || client.city_manual) return;
    if (client.city.trim() === label) return;

    await updateClient(supabase, clientId, { city: label }, tenantId);
    qc.invalidateQueries({ queryKey: ["clients"] });
    qc.invalidateQueries({ queryKey: ["client", clientId] });
  } catch {
    // Автоматика не должна ронять сохранение записи — тихий скип
    // (холодный оффлайн-кэш, гонка с удалением клиента и т.п.).
  }
}
