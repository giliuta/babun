import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Json } from "@babun/shared/db/database.types";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { useDataRole } from "@/features/settings/tenant";
import {
  applyPatch,
  parseSmsAccount,
  parseSmsHistory,
  type SmsAccount,
  type SmsSettingsPatch,
} from "./sms-model";

export * from "./sms-model";

// КАБИНЕТ SMS — ЧТЕНИЕ И ЗАПИСЬ (STORY-089, волна 2).
//
// Всё решает база (`sms_account`, `sms_save_settings`, `sms_history`,
// `sms_send_manual`): экран только показывает и просит. Баланс приходит
// только владельцу — сотрудник узнаёт лишь, можно ли отправить через сервис
// в его календаре и хватает ли денег (`can_pay`).

export const smsAccountKey = (tenantId: string | null) => ["sms-account", tenantId];
export const smsHistoryKey = (tenantId: string | null) => ["sms-history", tenantId];

export function useSmsAccount() {
  const tenantId = useTenantId();
  const role = useDataRole();
  return useQuery({
    queryKey: smsAccountKey(tenantId),
    enabled: !!tenantId && role.isSuccess && role.data != null,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("sms_account");
      if (error) throw new Error(error.message);
      return parseSmsAccount(data);
    },
  });
}

export function useSaveSmsSettings() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: SmsSettingsPatch) => {
      const { data, error } = await supabase.rpc("sms_save_settings", {
        p: patch as unknown as Json,
      });
      if (error) throw new Error(error.message);
      return parseSmsAccount(data);
    },
    // Выключатели откликаются сразу, а ответ базы — истина после.
    onMutate: async (patch) => {
      const key = smsAccountKey(tenantId);
      await qc.cancelQueries({ queryKey: key });
      const before = qc.getQueryData<SmsAccount>(key);
      if (before) qc.setQueryData<SmsAccount>(key, applyPatch(before, patch));
      return { before };
    },
    onError: (_e, _patch, context) => {
      if (context?.before) qc.setQueryData(smsAccountKey(tenantId), context.before);
    },
    onSuccess: (account) => qc.setQueryData(smsAccountKey(tenantId), account),
    meta: { errorHandled: true },
  });
}

export function useSmsHistory(limit = 50) {
  const tenantId = useTenantId();
  const role = useDataRole();
  return useQuery({
    queryKey: [...smsHistoryKey(tenantId), limit],
    enabled: !!tenantId && role.data === "owner",
    queryFn: async () => {
      const { data, error } = await supabase.rpc("sms_history", { p_limit: limit });
      if (error) throw new Error(error.message);
      return parseSmsHistory(data);
    },
  });
}

export function useSendSmsViaService() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      appointmentId: string | null;
      clientId: string | null;
      body: string;
      templateId?: string | null;
    }) => {
      const { data, error } = await supabase.rpc("sms_send_manual", {
        // Пустые записи и клиент — законное «нет» для базы: RPC ждёт null,
        // а сгенерированные типы аргументов null не описывают.
        p_appointment_id: input.appointmentId as string,
        p_client_id: input.clientId as string,
        p_body: input.body,
        p_template_id: input.templateId ?? undefined,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: smsAccountKey(tenantId) });
      void qc.invalidateQueries({ queryKey: smsHistoryKey(tenantId) });
    },
    meta: { errorHandled: true },
  });
}

export function useSetClientSmsOptOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { clientId: string; value: boolean }) => {
      const { error } = await supabase.rpc("set_client_sms_opt_out", {
        p_client_id: input.clientId,
        p_value: input.value,
      });
      if (error) throw new Error(error.message);
      return input.value;
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ["clients"] }),
    meta: { errorHandled: true },
  });
}

/** Суммы пополнения — те же, что знает функция `sms-checkout`. */
export const TOPUP_AMOUNTS_CENTS = [1000, 2500, 5000, 10000] as const;

/** Оплата на сайте: функция открывает Stripe Checkout и отдаёт адрес. */
export async function startSmsTopup(amountCents: number, returnUrl: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke("sms-checkout", {
    body: { amount_cents: amountCents, return_url: returnUrl },
  });
  if (error) throw new Error(error.message);
  const url = (data as { url?: string } | null)?.url;
  if (!url) throw new Error("Оплата не открылась");
  return url;
}
