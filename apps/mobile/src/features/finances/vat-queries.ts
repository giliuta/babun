import { useQuery } from "@tanstack/react-query";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import {
  effectiveVatSettings,
  summarizeVat,
  type VatMode,
  type VatSettings,
} from "@babun/shared/local/finance/vat";

import { accountVatDueQueryKey } from "@/lib/company-query-keys";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";

// НАСТРОЙКИ НДС: дефолт компании + переопределение на команду.
//
// Команды работают в разных странах (Кипр 19, Греция 24 одновременно),
// поэтому ставка живёт не «на бизнесе», а на команде — с наследованием от
// компании. Действующее значение считает одна серверная функция, чтобы
// «какая ставка у этой команды» не получило три разных ответа.
//
// На уровне КОМПАНИИ vat_exemption_note и document_language из клиентского
// контура убраны (аудит 2026-08-16, U39/U103): ни ввода, ни печати у них не
// было — колонки в БД остаются, вернуть поля можно вместе с их UI. На уровне
// команды exemptionNote остаётся: экран НДС команды сознательно проносит его
// через свой upsert, не затирая чужое значение.

export interface TeamVatOverride {
  teamId: string;
  mode: VatMode | null;
  rate: number | null;
  exemptionNote: string | null;
}

export function useVatSettings() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["vat-settings", tenantId],
    enabled: !!tenantId,
    queryFn: async (): Promise<VatSettings> => {
      // СОТРУДНИКУ ТАБЛИЦА КОМПАНИИ ЗАКРЫТА (аудит 11.10): `.single()` по
      // нулю строк бросал, и новый инвойс партнёра падал на загрузке, а в
      // записи и чеке ставка выходила 0 %. Строки нет — ставка из безопасного
      // профиля компании (`current_tenant_profile_safe` отдаёт её всем членам).
      const { data, error } = await supabase
        .from("tenants")
        .select("vat_mode, vat_rate")
        .eq("id", tenantId as string)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (data) {
        return {
          mode: (data.vat_mode ?? "off") as VatMode,
          rate: Number(data.vat_rate ?? 0),
        };
      }
      const profile = await supabase.rpc("current_tenant_profile_safe");
      if (profile.error) throw new Error(profile.error.message);
      const row = (profile.data ?? {}) as { vat_mode?: string | null; vat_rate?: number | string | null };
      return {
        mode: (row.vat_mode ?? "off") as VatMode,
        rate: Number(row.vat_rate ?? 0),
      };
    },
  });
}

export function useTeamVatOverrides() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["vat-team-overrides", tenantId],
    enabled: !!tenantId,
    queryFn: async (): Promise<TeamVatOverride[]> => {
      const { data, error } = await supabase
        .from("team_finance_settings")
        .select("team_id, vat_mode, vat_rate, vat_exemption_note")
        .eq("tenant_id", tenantId as string);
      if (error) throw new Error(error.message);
      return (data ?? []).map((r) => ({
        teamId: r.team_id,
        mode: (r.vat_mode ?? null) as VatMode | null,
        rate: r.vat_rate == null ? null : Number(r.vat_rate),
        exemptionNote: r.vat_exemption_note ?? null,
      }));
    },
  });
}

/** СТАВКА КОМАНДЫ ИЗ НАСТРОЕК — умолчание для нового документа, пока человек
 *  не написал свою (`useRememberedVatRate`). 0 — настройка ещё едет или
 *  ставки нет. Режим компании не гасит ставку: тумблера VAT больше нет
 *  (владелец 2026-09-30: «должно быть всё включено»), налог выбирают клавишей
 *  в самом документе. */
export function useTeamVatRate(teamId: string | null | undefined): number {
  const vat = useVatSettings().data;
  const overrides = useTeamVatOverrides().data;
  const settings = effectiveVatSettings(
    vat,
    teamId ? (overrides ?? []).find((o) => o.teamId === teamId) : undefined,
    null,
  );
  return settings.rate > 0 ? settings.rate : 0;
}

// Резолвер действующего НДС живёт в shared рядом с остальной математикой
// налога — там он тестируется как чистая функция (зеркало серверного
// fill_transaction_vat). Здесь только реэкспорт для экранов.
export { effectiveVatSettings } from "@babun/shared/local/finance/vat";

/** Сколько проводок читать за один заход: предел PostgREST — тысяча строк. */
const VAT_PAGE = 1000;

/**
 * VAT К УПЛАТЕ ПО СЧЁТУ (владелец 2026-09-23: «общая сумма, а в скобочках —
 * сколько VAT мы должны будем заплатить с этого счёта»). Та же формула, что у
 * отчёта по налогу (`summarizeVat`): собранное с клиентов минус уплаченное
 * поставщикам; переводы и «Без VAT» не считаются. Читаются только проводки с
 * налогом — остальные в сумму ничего не дают.
 */
export function useAccountVatDue(accountId: string, enabled: boolean) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: accountVatDueQueryKey(tenantId, accountId),
    enabled: enabled && !!tenantId,
    queryFn: async (): Promise<number> => {
      const rows: FinanceTransaction[] = [];
      for (let from = 0; ; from += VAT_PAGE) {
        const { data, error } = await supabase
          .from("finance_transactions")
          .select("id, type, amount, vat_mode, vat_amount")
          .eq("account_id", accountId)
          .not("vat_amount", "is", null)
          .order("id")
          .range(from, from + VAT_PAGE - 1);
        if (error) throw new Error(error.message);
        const page = (data ?? []).map((r) => ({
          ...r,
          amount: Number(r.amount),
          vat_amount: r.vat_amount == null ? null : Number(r.vat_amount),
        })) as unknown as FinanceTransaction[];
        rows.push(...page);
        if (page.length < VAT_PAGE) break;
      }
      return summarizeVat(rows).due;
    },
  });
}

