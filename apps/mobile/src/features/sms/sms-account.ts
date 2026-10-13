import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Json } from "@babun/shared/db/database.types";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { useDataRole } from "@/features/settings/tenant";
import { useAccountScope } from "@/features/cabinet/account-scope";
import {
  applyPatch,
  parseSmsAccount,
  parseSmsHistory,
  parseSmsRecordLog,
  type SmsAccount,
  type SmsHistoryItem,
  type SmsSettingsPatch,
} from "./sms-model";
import { clientKeys } from "@/features/clients/query-keys";
import {
  clientOf,
  smsAccountKey,
  smsHistoryKey,
  smsLogKey,
} from "./sms-account/keys";

export * from "./sms-model";
export * from "./sms-team-templates";

// КАБИНЕТ SMS — ЧТЕНИЕ И ЗАПИСЬ (STORY-089, волна 2).
//
// Всё решает база (`sms_account`, `sms_save_settings`, `sms_history`,
// `sms_send_manual`, шаблоны команд `sms_team_templates` / `sms_save_team_template`
// / `sms_set_team_template_enabled` / `sms_delete_team_template`): экран
// только показывает и просит. Баланс приходит
// только владельцу — сотрудник узнаёт лишь, можно ли отправить через сервис
// в его календаре и хватает ли денег (`can_pay`).
//
// Query keys, team templates and the Stripe top-up live in `./sms-account/`;
// this path stays the public entry.

export {
  smsAccountKey,
  smsHistoryKey,
  smsLogKey,
  smsTemplatesKey,
} from "./sms-account/keys";
export {
  useDeleteTeamTemplate,
  useReorderTeamTemplates,
  useSaveTeamTemplate,
  useSetTeamTemplateEnabled,
  useTeamTemplates,
} from "./sms-account/templates";
export {
  SMS_PAY_DONE_URL,
  openSmsCheckout,
  startSmsTopup,
} from "./sms-account/checkout";

export function useSmsAccount() {
  // Баланс АККАУНТА СТРАНИЦЫ (04.10): в блоке пригласившего аккаунта —
  // его, а не того, что открыт на телефоне.
  const { tenantId, client, role } = useAccountScope();
  return useQuery({
    queryKey: smsAccountKey(tenantId),
    enabled: !!tenantId && role != null,
    queryFn: async () => {
      const { data, error } = await client.rpc("sms_account");
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

/** Имя отправителя команды; пустое — снять. Ответ базы — свежий счёт. */
export function useSaveTeamSender() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { teamId: string; name: string }) => {
      const { data, error } = await supabase.rpc("sms_save_team_sender", {
        p_team_id: input.teamId,
        p_name: input.name,
      });
      if (error) throw new Error(error.message);
      return parseSmsAccount(data);
    },
    onSuccess: (account) => qc.setQueryData(smsAccountKey(tenantId), account),
    meta: { errorHandled: true },
  });
}

/** Автопополнение (волна 13): включить — только с сохранённой картой,
 *  порог и сумма — из готовых. Ответ базы — новый вид страницы. */
export function useSaveAutotopup() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: { enabled?: boolean; thresholdCents?: number; amountCents?: number }) => {
      const { data, error } = await supabase.rpc("sms_autotopup_save", {
        p: {
          ...(patch.enabled !== undefined ? { enabled: patch.enabled } : null),
          ...(patch.thresholdCents !== undefined ? { threshold_cents: patch.thresholdCents } : null),
          ...(patch.amountCents !== undefined ? { amount_cents: patch.amountCents } : null),
        },
      });
      if (error) throw new Error(error.message);
      return parseSmsAccount(data);
    },
    onSuccess: (account) => qc.setQueryData(smsAccountKey(tenantId), account),
    meta: { errorHandled: true },
  });
}

/** Убрать карту: автопополнение выключается, карта больше не списывается. */
export function useForgetAutotopupCard() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("sms_autotopup_forget");
      if (error) throw new Error(error.message);
      return parseSmsAccount(data);
    },
    onSuccess: (account) => qc.setQueryData(smsAccountKey(tenantId), account),
    meta: { errorHandled: true },
  });
}

/** История: вся или одной команды / одного события. */
export function useSmsHistory(limit = 50, filter?: { teamId?: string | null; trigger?: string | null }) {
  // История сообщений — только владельцу ЭТОГО аккаунта: партнёр с правом
  // «SMS» видит баланс, но не переписку с клиентами (04.10).
  const { tenantId, client, role } = useAccountScope();
  const teamId = filter?.teamId ?? null;
  const trigger = filter?.trigger ?? null;
  return useQuery({
    queryKey: [...smsHistoryKey(tenantId), limit, teamId, trigger],
    enabled: !!tenantId && role === "owner",
    queryFn: async () => {
      const { data, error } = await client.rpc("sms_history", {
        p_limit: limit,
        p_team_id: teamId ?? undefined,
        p_trigger: trigger ?? undefined,
      });
      if (error) throw new Error(error.message);
      return parseSmsHistory(data);
    },
  });
}

const HISTORY_PAGE = 100;

/** Вся история страницами: долистал до конца — пришли следующие сто. */
export function useSmsHistoryPages(teamId: string | null) {
  const tenantId = useTenantId();
  const role = useDataRole();
  return useInfiniteQuery({
    queryKey: [...smsHistoryKey(tenantId), "pages", teamId],
    enabled: !!tenantId && role.data === "owner",
    staleTime: 0,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc("sms_history", {
        p_limit: HISTORY_PAGE,
        p_before: pageParam ?? undefined,
        p_team_id: teamId ?? undefined,
      });
      if (error) throw new Error(error.message);
      return parseSmsHistory(data);
    },
    getNextPageParam: (last) =>
      last.length < HISTORY_PAGE ? undefined : (last[last.length - 1]?.createdAt ?? undefined),
  });
}

/** Сколько ждать между сверками, пока SMS «в пути»; `false` — не сверять.
 *  Статус меняет сервер по отчёту оператора (секунды), а блок читается при
 *  открытии — и «Отправляется» висело, хотя SMS давно «Доставлено» (владелец
 *  03.10). Сверяем только свежие (10 мин): старые без отчёта не крутят сеть. */
export function smsInFlightInterval(messages: readonly SmsHistoryItem[] | undefined, now = Date.now()): number | false {
  const fresh = (messages ?? []).some(
    (m) =>
      (m.status === "queued" || m.status === "sending" || m.status === "sent") &&
      now - Date.parse(m.createdAt) < 10 * 60 * 1000,
  );
  return fresh ? 4000 : false;
}

/** SMS записи — блок внизу страницы записи. */
export function useAppointmentSms(appointmentId: string | null | undefined) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: [...smsLogKey(tenantId), "appointment", appointmentId],
    enabled: !!tenantId && !!appointmentId,
    // Статусы («Доставлено», «Не доставлено») меняет сервер — при каждом
    // открытии записи и карточки блок перечитывается, а пока SMS «в пути» —
    // сверяется сам каждые несколько секунд.
    staleTime: 0,
    refetchInterval: (query) => smsInFlightInterval(query.state.data?.messages),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("sms_for_appointment", {
        p_appointment_id: appointmentId as string,
      });
      if (error) throw new Error(error.message);
      return parseSmsRecordLog(data);
    },
  });
}

/** Ссылка «Подтвердить / Отменить» записи — для ручной отправки, когда
 *  выбранный текст просит [Ссылка]. Первая просьба заводит ссылку на
 *  сервере, дальше она та же. */
export function useAppointmentLink(appointmentId: string | null | undefined, enabled: boolean) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: [...smsLogKey(tenantId), "link", appointmentId],
    enabled: enabled && !!tenantId && !!appointmentId,
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("sms_appointment_link", {
        p_appointment_id: appointmentId as string,
      });
      if (error) throw new Error(error.message);
      return typeof data === "string" && data ? data : null;
    },
  });
}

/** SMS клиента — блок на странице клиента. `cardTenantId` — компания
 *  карточки; нет — активная. */
export function useClientSms(clientId: string | null | undefined, limit = 20, cardTenantId?: string | null) {
  const activeTenantId = useTenantId();
  const tenantId = cardTenantId ?? activeTenantId;
  return useQuery({
    queryKey: [...smsLogKey(tenantId), "client", clientId, limit],
    enabled: !!tenantId && !!clientId,
    staleTime: 0,
    refetchInterval: (query) => smsInFlightInterval(query.state.data),
    queryFn: async () => {
      const { data, error } = await clientOf(tenantId, activeTenantId).rpc("sms_for_client", {
        p_client_id: clientId as string,
        p_limit: limit,
      });
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
      /** Без записи — команда, от которой SMS: её имя отправителя в подписи. */
      teamId?: string | null;
      /** Выбранный номер клиента в E.164; нет — основной. */
      phone?: string | null;
    }) => {
      const { data, error } = await supabase.rpc("sms_send_manual", {
        // Пустые записи и клиент — законное «нет» для базы: RPC ждёт null,
        // а сгенерированные типы аргументов null не описывают.
        p_appointment_id: input.appointmentId as string,
        p_client_id: input.clientId as string,
        p_body: input.body,
        p_template_id: input.templateId ?? undefined,
        p_team_id: input.teamId ?? undefined,
        p_phone: input.phone ?? undefined,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: smsAccountKey(tenantId) });
      void qc.invalidateQueries({ queryKey: smsHistoryKey(tenantId) });
      void qc.invalidateQueries({ queryKey: smsLogKey(tenantId) });
    },
    meta: { errorHandled: true },
  });
}

/** Массовая рассылка через сервис — от одной команды, у каждого получателя
 *  свой готовый текст. Ответ — сколько поставлено и сколько пропущено. */
export function useSendSmsBulk() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { teamId: string; items: { clientId: string; body: string }[] }) => {
      const { data, error } = await supabase.rpc("sms_send_bulk", {
        p_team_id: input.teamId,
        p_items: input.items.map((x) => ({ client_id: x.clientId, body: x.body })) as unknown as Json,
      });
      if (error) throw new Error(error.message);
      const r = (data ?? {}) as { queued?: number; skipped?: number };
      return { queued: r.queued ?? 0, skipped: r.skipped ?? 0 };
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: smsAccountKey(tenantId) });
      void qc.invalidateQueries({ queryKey: smsHistoryKey(tenantId) });
      void qc.invalidateQueries({ queryKey: smsLogKey(tenantId) });
    },
    meta: { errorHandled: true },
  });
}

export function useSetClientSmsOptOut() {
  const qc = useQueryClient();
  const activeTenantId = useTenantId();
  return useMutation({
    mutationFn: async (input: { clientId: string; value: boolean; tenantId?: string | null }) => {
      const { error } = await clientOf(input.tenantId, activeTenantId).rpc("set_client_sms_opt_out", {
        p_client_id: input.clientId,
        p_value: input.value,
      });
      if (error) throw new Error(error.message);
      return input.value;
    },
    // КАРТОЧКА ТОЖЕ (аудит 03.10): у неё свой ключ `["client", id, …]`, и после
    // одного `["clients"]` шторка трубки ещё предлагала «Отправить от
    // компании» клиенту, который просил не писать, — сервер отвечал отказом.
    onSettled: (_value, _error, input) => {
      void qc.invalidateQueries({ queryKey: clientKeys.all() });
      void qc.invalidateQueries({ queryKey: clientKeys.card(input.clientId) });
    },
    meta: { errorHandled: true },
  });
}
