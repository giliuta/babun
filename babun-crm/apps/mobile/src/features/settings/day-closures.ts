import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Database } from "@babun/shared/db/database.types";
import { getStorage } from "@babun/shared/storage";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { useCurrentRole } from "@/features/settings/tenant";
import { shouldImportLegacyDayClosure } from "./day-closure-rollout";

export {
  cashCentsToInput,
  parseCashInputToCents,
} from "./day-closure-money";

type DayClosureRow = Database["public"]["Tables"]["day_closures"]["Row"];
type DayClosureReadRow = Database["public"]["Functions"]["read_day_closure"]["Returns"][number];
type DayClosureWireRow = DayClosureRow | DayClosureReadRow;

export interface DayClosureState {
  tenantId: string;
  businessDate: string;
  isClosed: boolean;
  expectedCashCents: number;
  actualCashCents: number | null;
  deltaCashCents: number | null;
  closedAt: string | null;
  reopenedAt: string | null;
  revision: number;
  authority: "server" | "legacy";
}

const LEGACY_PREFIX = "babun:closed-day:";
const LEGACY_OWNER_KEY = `${LEGACY_PREFIX}legacy-owner-tenant`;

function queryKey(
  tenantId: string | null,
  role: string | null | undefined,
  businessDate: string,
) {
  return [
    "day-closure",
    tenantId,
    role ?? "role-pending",
    businessDate,
  ] as const;
}

function scopedKey(tenantId: string, businessDate: string): string {
  return `${LEGACY_PREFIX}${tenantId}:${businessDate}`;
}

function serverSyncKey(tenantId: string, businessDate: string): string {
  return `${scopedKey(tenantId, businessDate)}:server-synced`;
}

function hasServerSync(tenantId: string, businessDate: string): boolean {
  try {
    return getStorage().getRaw(serverSyncKey(tenantId, businessDate)) === "1";
  } catch {
    return false;
  }
}

function markServerSynced(tenantId: string, businessDate: string): void {
  try {
    getStorage().setRaw(serverSyncKey(tenantId, businessDate), "1");
  } catch {
    // Query state is still authoritative for this session.
  }
}

function isMissingDayClosureContract(error: {
  code?: string;
  message?: string;
}): boolean {
  return (
    error.code === "42883" ||
    error.code === "PGRST202" ||
    /could not find the function.*(?:read_day_closure|close_business_day|reopen_business_day)/i.test(
      error.message ?? "",
    )
  );
}

function finiteInteger(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isSafeInteger(numberValue) ? numberValue : null;
}

function rowToState(row: DayClosureWireRow): DayClosureState {
  const expected = finiteInteger(row.expected_cash_cents);
  const actual = finiteInteger(row.actual_cash_cents);
  const delta = finiteInteger(row.delta_cash_cents);
  if (expected == null) {
    throw new Error("Сервер вернул некорректный остаток кассы");
  }
  return {
    tenantId: row.tenant_id,
    businessDate: row.business_date,
    isClosed: row.is_closed,
    expectedCashCents: expected,
    actualCashCents: actual,
    deltaCashCents: delta,
    closedAt: row.closed_at,
    reopenedAt: row.reopened_at,
    revision: row.revision,
    authority: "server",
  };
}

function firstClosureRow(
  value: readonly DayClosureWireRow[] | null,
): DayClosureWireRow {
  const row = value?.[0];
  if (!row) throw new Error("Сервер не вернул состояние закрытия дня");
  return row;
}

interface LegacyClosedRecord {
  isClosed?: boolean;
  closedAt?: string | null;
  reopenedAt?: string | null;
  expectedCash?: number;
  actualCash?: number;
  delta?: number;
  expectedCashCents?: number;
  actualCashCents?: number | null;
  deltaCashCents?: number | null;
}

function eurosToCents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

function parseLegacyRecord(
  raw: string,
  tenantId: string,
  businessDate: string,
  fallbackExpectedCashCents: number,
): DayClosureState | null {
  if (raw === "1") {
    return {
      tenantId,
      businessDate,
      isClosed: true,
      expectedCashCents: fallbackExpectedCashCents,
      actualCashCents: null,
      deltaCashCents: null,
      closedAt: null,
      reopenedAt: null,
      revision: 1,
      authority: "legacy",
    };
  }
  try {
    const parsed = JSON.parse(raw) as LegacyClosedRecord;
    const expected =
      finiteInteger(parsed.expectedCashCents) ??
      eurosToCents(parsed.expectedCash ?? fallbackExpectedCashCents / 100);
    const explicitActualCents = finiteInteger(parsed.actualCashCents);
    const actual =
      parsed.actualCashCents === null
        ? null
        : explicitActualCents ??
          (typeof parsed.actualCash === "number"
            ? eurosToCents(parsed.actualCash)
            : null);
    const delta =
      parsed.deltaCashCents === null
        ? null
        : finiteInteger(parsed.deltaCashCents) ??
          (actual == null ? null : actual - expected);
    return {
      tenantId,
      businessDate,
      isClosed: parsed.isClosed ?? true,
      expectedCashCents: expected,
      actualCashCents: actual,
      deltaCashCents: delta,
      closedAt: parsed.closedAt || null,
      reopenedAt: parsed.reopenedAt ?? null,
      revision: 1,
      authority: "legacy",
    };
  } catch {
    return null;
  }
}

function readLegacyState(
  tenantId: string,
  businessDate: string,
  fallbackExpectedCashCents: number,
): DayClosureState {
  try {
    const storage = getStorage();
    const scoped = storage.getRaw(scopedKey(tenantId, businessDate));
    if (scoped) {
      const parsed = parseLegacyRecord(
        scoped,
        tenantId,
        businessDate,
        fallbackExpectedCashCents,
      );
      if (parsed) return parsed;
    }

    const oldUnscoped = storage.getRaw(`${LEGACY_PREFIX}${businessDate}`);
    const owner = storage.getRaw(LEGACY_OWNER_KEY);
    if (oldUnscoped && (!owner || owner === tenantId)) {
      if (!owner) storage.setRaw(LEGACY_OWNER_KEY, tenantId);
      const parsed = parseLegacyRecord(
        oldUnscoped,
        tenantId,
        businessDate,
        fallbackExpectedCashCents,
      );
      if (parsed) {
        writeLegacyState(parsed);
        return parsed;
      }
    }
  } catch {
    // The fallback is best-effort. Returning an explicit open state is safer
    // than crashing the settings route before the server can be retried.
  }
  return {
    tenantId,
    businessDate,
    isClosed: false,
    expectedCashCents: fallbackExpectedCashCents,
    actualCashCents: null,
    deltaCashCents: null,
    closedAt: null,
    reopenedAt: null,
    revision: 0,
    authority: "legacy",
  };
}

function writeLegacyState(state: DayClosureState): void {
  try {
    getStorage().setRaw(
      scopedKey(state.tenantId, state.businessDate),
      JSON.stringify({
        isClosed: state.isClosed,
        closedAt: state.closedAt,
        reopenedAt: state.reopenedAt,
        expectedCashCents: state.expectedCashCents,
        actualCashCents: state.actualCashCents,
        deltaCashCents: state.deltaCashCents,
      } satisfies LegacyClosedRecord),
    );
  } catch {
    // Server state is still canonical. Cache persistence is best-effort.
  }
}

export function useDayClosure(
  businessDate: string,
  fallbackExpectedCashCents: number,
) {
  const tenantId = useTenantId();
  const roleQuery = useCurrentRole();
  const role = roleQuery.data;
  return useQuery({
    queryKey: queryKey(tenantId, role, businessDate),
    enabled: !!tenantId && roleQuery.isSuccess && role === "owner",
    queryFn: async (): Promise<DayClosureState> => {
      const activeTenantId = tenantId as string;
      const legacy = readLegacyState(
        activeTenantId,
        businessDate,
        fallbackExpectedCashCents,
      );
      const { data, error } = await supabase.rpc("read_day_closure", {
        p_business_date: businessDate,
      });
      if (error) {
        if (isMissingDayClosureContract(error)) {
          throw new Error(
            "Закрытие дня ещё не подключено на сервере. Обновите серверную схему и повторите.",
          );
        }
        throw new Error(error.message);
      }
      let state = rowToState(firstClosureRow(data));
      if (
        shouldImportLegacyDayClosure(
          state,
          legacy,
          hasServerSync(activeTenantId, businessDate),
        )
      ) {
        const { data: imported, error: importError } = await supabase.rpc(
          "close_business_day",
          {
            p_business_date: businessDate,
            p_actual_cash_cents: legacy.actualCashCents as number,
          },
        );
        if (importError) throw new Error(importError.message);
        state = rowToState(firstClosureRow(imported));
      }
      markServerSynced(activeTenantId, businessDate);
      writeLegacyState(state);
      return state;
    },
  });
}

export function useCloseDay(
  businessDate: string,
  _fallbackExpectedCashCents: number,
) {
  const tenantId = useTenantId();
  const role = useCurrentRole().data;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (actualCashCents: number): Promise<DayClosureState> => {
      if (!tenantId) throw new Error("Нет активной компании");
      if (role !== "owner") throw new Error("Закрыть день может только владелец.");
      if (!Number.isSafeInteger(actualCashCents) || actualCashCents < 0) {
        throw new Error("Введите корректную фактическую сумму кассы.");
      }
      const { data, error } = await supabase.rpc("close_business_day", {
        p_business_date: businessDate,
        p_actual_cash_cents: actualCashCents,
      });
      if (error) {
        if (isMissingDayClosureContract(error)) {
          throw new Error(
            "День не закрыт: серверная схема финансов ещё не обновлена.",
          );
        }
        throw new Error(error.message);
      }
      const state = rowToState(firstClosureRow(data));
      markServerSynced(tenantId, businessDate);
      writeLegacyState(state);
      return state;
    },
    onSuccess: (state) =>
      queryClient.setQueryData(queryKey(tenantId, role, businessDate), state),
    meta: { errorHandled: true },
  });
}

export function useReopenDay(
  businessDate: string,
  _fallbackExpectedCashCents: number,
) {
  const tenantId = useTenantId();
  const role = useCurrentRole().data;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<DayClosureState> => {
      if (!tenantId) throw new Error("Нет активной компании");
      if (role !== "owner") throw new Error("Открыть день может только владелец.");
      const { error } = await supabase.rpc("reopen_business_day", {
        p_business_date: businessDate,
      });
      if (error) {
        if (isMissingDayClosureContract(error)) {
          throw new Error(
            "День не открыт: серверная схема финансов ещё не обновлена.",
          );
        }
        throw new Error(error.message);
      }
      // The reopen RPC returns the retained audit row. Read once more so an
      // open screen shows the live canonical cash balance, not the old close
      // snapshot that was just unlocked.
      const { data: refreshed, error: refreshError } = await supabase.rpc(
        "read_day_closure",
        { p_business_date: businessDate },
      );
      if (refreshError) throw new Error(refreshError.message);
      const state = rowToState(firstClosureRow(refreshed));
      markServerSynced(tenantId, businessDate);
      writeLegacyState(state);
      return state;
    },
    onSuccess: (state) =>
      queryClient.setQueryData(queryKey(tenantId, role, businessDate), state),
    meta: { errorHandled: true },
  });
}
