import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { VatMode, VatSettings } from "@babun/shared/local/finance/vat";

import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";

// НАСТРОЙКИ НДС: дефолт компании + переопределение на команду.
//
// Команды работают в разных странах (Кипр 19, Греция 24 одновременно),
// поэтому ставка живёт не «на бизнесе», а на команде — с наследованием от
// компании. Действующее значение считает одна серверная функция, чтобы
// «какая ставка у этой бригады» не получило три разных ответа.

export interface TenantVatSettings extends VatSettings {
  documentLanguage: string;
}

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
    queryFn: async (): Promise<TenantVatSettings> => {
      const { data, error } = await supabase
        .from("tenants")
        .select("vat_mode, vat_rate, vat_exemption_note, document_language")
        .eq("id", tenantId as string)
        .single();
      if (error) throw new Error(error.message);
      return {
        mode: (data.vat_mode ?? "off") as VatMode,
        rate: Number(data.vat_rate ?? 0),
        exemptionNote: data.vat_exemption_note ?? null,
        documentLanguage: data.document_language ?? "en",
      };
    },
  });
}

export function useSaveVatSettings() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<TenantVatSettings>) => {
      if (!tenantId) throw new Error("Нет активного тенанта");
      const { error } = await supabase
        .from("tenants")
        .update({
          ...(patch.mode !== undefined ? { vat_mode: patch.mode } : {}),
          ...(patch.rate !== undefined ? { vat_rate: patch.rate } : {}),
          ...(patch.exemptionNote !== undefined
            ? { vat_exemption_note: patch.exemptionNote }
            : {}),
          ...(patch.documentLanguage !== undefined
            ? { document_language: patch.documentLanguage }
            : {}),
        })
        .eq("id", tenantId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["vat-settings"] });
      // Ставка меняет то, как считается цена «плюс НДС» на новых операциях.
      void qc.invalidateQueries({ queryKey: ["transactions"] });
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

export function useSaveTeamVat() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: TeamVatOverride) => {
      if (!tenantId) throw new Error("Нет активного тенанта");
      // Пустое переопределение — это «наследовать компанию», а не «нули».
      const empty =
        input.mode === null && input.rate === null && !input.exemptionNote;
      if (empty) {
        const { error } = await supabase
          .from("team_finance_settings")
          .delete()
          .eq("tenant_id", tenantId)
          .eq("team_id", input.teamId);
        if (error) throw new Error(error.message);
        return;
      }
      const { error } = await supabase.from("team_finance_settings").upsert(
        {
          tenant_id: tenantId,
          team_id: input.teamId,
          vat_mode: input.mode,
          vat_rate: input.rate,
          vat_exemption_note: input.exemptionNote,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,team_id" },
      );
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["vat-team-overrides"] });
    },
  });
}

/**
 * Действующий НДС для конкретной операции: счёт → команда → компания.
 *
 * Счёт побеждает команду не по прихоти: «счёт с НДС» — это про то, КУДА
 * приходят деньги. На расчётный падает выручка с налогом, а в кассу от
 * частника — без, и обе операции живут в одной команде.
 */
export function effectiveVatSettings(
  tenant: TenantVatSettings | undefined,
  teamOverride: TeamVatOverride | undefined,
  accountMode: VatMode | null | undefined,
): VatSettings {
  const base: VatSettings = tenant
    ? { mode: tenant.mode, rate: tenant.rate, exemptionNote: tenant.exemptionNote }
    : { mode: "off", rate: 0, exemptionNote: null };
  const mode = accountMode ?? teamOverride?.mode ?? base.mode;
  const rate = teamOverride?.rate ?? base.rate;
  const exemptionNote = teamOverride?.exemptionNote ?? base.exemptionNote;
  return { mode, rate, exemptionNote };
}

export const VAT_MODE_LABELS: Record<VatMode, string> = {
  off: "Без НДС",
  inclusive: "НДС включён в цену",
  exclusive: "НДС плюсом к цене",
};

/** Подпись под строкой настройки: показывает действующее значение, чтобы не
 *  проваливаться внутрь ради проверки. */
export function vatSummaryLine(v: TenantVatSettings | undefined): string {
  if (!v) return "Загрузка…";
  if (v.mode === "off") return "Выключен";
  return `${VAT_MODE_LABELS[v.mode]} · ${v.rate}%`;
}
