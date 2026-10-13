import { useCallback } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { generateId } from "@babun/shared/local/masters";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { citiesQueryKey } from "@/lib/company-query-keys";
import { useDataRole } from "@/features/settings/tenant";
import { pickTeamLabels } from "../reference-select";
import { referenceKeys } from "../query-keys";
import { useReferenceCompany } from "./company";
import { assertCanWriteReference, updateRefRow } from "./ref-write";
import type { City } from "./types";

// ─── Cities ──────────────────────────────────────────────────────────
// `includeInactive` — экран «Города» показывает и выключенные (тумблер
// активности + реактивация); пикеры/метки зовут без опции и видят
// только активные (паттерн useTeams).
// МЕТКИ ЧИТАЮТСЯ ПО КОМАНДЕ (владелец 2026-08-29: «метка закрепляется за
// командой — то же самое, как график, как услуга; нельзя поставить метку в
// другую команду»). Без `teamId` вернётся весь справочник тенанта: так
// читают экраны, которым нужно назвать метку прошлого дня, а не предложить
// её к выбору.
export function useCities(opts?: {
  includeInactive?: boolean;
  teamId?: string | null;
}) {
  const { tenantId, client, ready } = useReferenceCompany();
  const includeInactive = !!opts?.includeInactive;
  const teamId = opts?.teamId ?? null;
  // КЛЮЧ — ВЕСЬ СПРАВОЧНИК КОМПАНИИ, КОМАНДА — `select` (2026-09-15). Ключ по
  // команде означал запрос на каждый первый тап по календарю, и сетка ждала
  // его скелетом. Отбор повторяет `.eq("team_id")` из `fetchCities` точь-в-точь
  // (`reference-select.ts`, с тестом); RLS меток и так отдаёт всю компанию.
  const select = useCallback(
    (rows: City[]) => pickTeamLabels(rows, teamId),
    [teamId],
  );
  return useQuery({
    queryKey: citiesQueryKey(tenantId, includeInactive, null),
    // ЖДЁТ РОЛЬ, КАК СОСЕДИ (команды, метки дней — 06.10). Без входа роль не
    // читается (401), а метки читались: на выходе из аккаунта календарь
    // успевал получить анонимом «200, пусто», и после входа дни стояли
    // серыми с «У команды пока нет меток».
    enabled: !!tenantId && ready,
    queryFn: () =>
      fetchCities(client, tenantId as string, includeInactive, null),
    select,
  });
}

/** Чтение городов ЧИСТОЙ функцией (см. `fetchTeams`). */
export async function fetchCities(
  client: typeof supabase,
  tenantId: string,
  includeInactive: boolean,
  teamId: string | null,
): Promise<City[]> {
  let q = client.from("cities").select("*").eq("tenant_id", tenantId);
  if (!includeInactive) q = q.eq("is_active", true);
  // Метка принадлежит команде: без её id вернётся весь справочник
  // тенанта — так читают экраны, которым нужно НАЗВАТЬ метку прошлого
  // дня, а не предложить её к выбору.
  if (teamId) q = q.eq("team_id", teamId);
  // Второй ключ — время создания (см. календари выше).
  const { data, error } = await q.order("position").order("created_at");
  if (error) throw new Error(error.message);
  return data;
}

export function useCreateCity() {
  const tenantId = useTenantId();
  const role = useDataRole().data;
  const qc = useQueryClient();
  return useMutation({
    // `color` — v492 labels: custom tags («Германия», «День ног») get a
    // per-city accent colour that tints the calendar day chip (web parity).
    mutationFn: async (input: {
      name: string;
      country?: string;
      color?: string;
      /** Дни недели (1=Пн…7=Вс), когда метка встаёт сама. Пусто — вручную. */
      weekdays?: number[];
      /** Команда-владелец. Метка без команды больше не существует. */
      teamId: string;
      /** Заливать ли колонку дня цветом метки. По умолчанию да. */
      tintDay?: boolean;
    }) => {
      // Сотрудник — по праву «Метки» своей команды (30.09): его проверяет
      // политика `cities_write_access`, телефон только не пускает гостя.
      if (role !== "owner" && role !== "dispatcher" && role !== "master") {
        throw new Error("Добавлять метки может владелец или диспетчер.");
      }
      const { data, error } = await supabase
        .from("cities")
        .insert({
          id: generateId("city"),
          tenant_id: tenantId as string,
          name: input.name,
          country: input.country || "",
          color: input.color || null,
          weekdays: input.weekdays ?? [],
          tint_day: input.tintDay ?? true,
          team_id: input.teamId,
        })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: referenceKeys.cityAll() }),
    meta: { errorHandled: true }, // RefListScreen call sites alert themselves
  });
}

/**
 * ПОРЯДОК МЕТОК — ЭТО ЧТЕНИЕ. Владелец 2026-08-17: «если задержать, можно
 * будет переносить — справа шесть точек, чтоб можно было менять местами».
 * Пишем `position` всем строкам разом: половина списка с новым номером и
 * половина со старым — это не порядок, а лотерея, поэтому запросы уходят
 * параллельно и инвалидация одна на всех.
 */
export function useReorderCities() {
  const tenantId = useTenantId();
  const role = useDataRole().data;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: readonly string[]) => {
      if (!tenantId) throw new Error("Нет активного аккаунта.");
      assertCanWriteReference("cities", role);
      await Promise.all(
        ids.map((id, index) =>
          updateRefRow({
            table: "cities",
            tenantId,
            id,
            patch: { position: index },
          }),
        ),
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: referenceKeys.cityAll() }),
    meta: { errorHandled: true },
  });
}

/** ОКОНЧАТЕЛЬНАЯ ЗАЧИСТКА МЕТОК, УДАЛЁННЫХ БОЛЬШЕ 30 ДНЕЙ НАЗАД.
 *
 *  Крона в продукте нет, а обещание «через 30 дней удалится совсем» должно
 *  когда-то исполняться. Естественный момент — открытие экрана меток: там же,
 *  где удаляют, и не чаще, чем туда заходят.
 *
 *  Тихая: сбой зачистки не повод показывать человеку ошибку — метка просто
 *  доживёт до следующего захода. */
export function usePurgeExpiredCities() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useCallback(async () => {
    if (!tenantId) return;
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { error, count } = await supabase
      .from("cities")
      .delete({ count: "exact" })
      .eq("tenant_id", tenantId)
      .not("deleted_at", "is", null)
      .lt("deleted_at", cutoff);
    if (!error && (count ?? 0) > 0) {
      qc.invalidateQueries({ queryKey: referenceKeys.cityAll() });
    }
  }, [tenantId, qc]);
}
