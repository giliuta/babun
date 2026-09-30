import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Json } from "@babun/shared/db/database.types";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { useDataRole } from "@/features/settings/tenant";
import {
  applyPatch,
  parseSmsAccount,
  parseSmsHistory,
  parseSmsRecordLog,
  type SmsAccount,
  type SmsSettingsPatch,
} from "./sms-model";
import {
  draftPayload,
  parseTeamTemplate,
  parseTeamTemplates,
  type SmsTeamTemplate,
  type TemplateDraft,
} from "./sms-team-templates";

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

export const smsAccountKey = (tenantId: string | null) => ["sms-account", tenantId];
export const smsHistoryKey = (tenantId: string | null) => ["sms-history", tenantId];
/** SMS записи и клиента — один префикс: после отправки перечитываются оба. */
export const smsLogKey = (tenantId: string | null) => ["sms-log", tenantId];
/** Шаблоны команд: все и одной команды — один префикс. */
export const smsTemplatesKey = (tenantId: string | null) => ["sms-team-templates", tenantId];

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

/** Шаблоны команды (`teamId`) или всех видимых команд (`null`). */
export function useTeamTemplates(teamId: string | null) {
  const tenantId = useTenantId();
  const role = useDataRole();
  return useQuery({
    queryKey: [...smsTemplatesKey(tenantId), teamId],
    enabled: !!tenantId && role.isSuccess && role.data != null,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("sms_team_templates", { p_team_id: teamId ?? undefined });
      if (error) throw new Error(error.message);
      return parseTeamTemplates(data);
    },
  });
}

/** После правки шаблона перечитываются списки, счёт шаблонов команд и
 *  шаблоны в листах записи. */
function useTemplatesChanged() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: smsTemplatesKey(tenantId) });
    void qc.invalidateQueries({ queryKey: smsAccountKey(tenantId) });
    void qc.invalidateQueries({ queryKey: smsLogKey(tenantId) });
  };
}

export function useSaveTeamTemplate() {
  const changed = useTemplatesChanged();
  return useMutation({
    mutationFn: async (draft: TemplateDraft): Promise<SmsTeamTemplate> => {
      const { data, error } = await supabase.rpc("sms_save_team_template", {
        p: draftPayload(draft) as unknown as Json,
      });
      if (error) throw new Error(error.message);
      const saved = parseTeamTemplate(data);
      if (!saved) throw new Error("Шаблон не сохранился");
      return saved;
    },
    onSettled: changed,
    meta: { errorHandled: true },
  });
}

/** Включить / выключить: строка откликается сразу, ответ базы — после. */
export function useSetTeamTemplateEnabled() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const changed = useTemplatesChanged();
  return useMutation({
    mutationFn: async (input: { id: string; enabled: boolean }) => {
      const { error } = await supabase.rpc("sms_set_team_template_enabled", {
        p_id: input.id,
        p_enabled: input.enabled,
      });
      if (error) throw new Error(error.message);
      return input;
    },
    onMutate: async (input) => {
      const key = smsTemplatesKey(tenantId);
      await qc.cancelQueries({ queryKey: key });
      const before = qc.getQueriesData<SmsTeamTemplate[]>({ queryKey: key });
      qc.setQueriesData<SmsTeamTemplate[]>({ queryKey: key }, (list) =>
        list?.map((x) => (x.id === input.id ? { ...x, enabled: input.enabled } : x)),
      );
      return { before };
    },
    onError: (_e, _input, context) => {
      for (const [key, value] of context?.before ?? []) qc.setQueryData(key, value);
    },
    onSettled: changed,
    meta: { errorHandled: true },
  });
}

export function useDeleteTeamTemplate() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const changed = useTemplatesChanged();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("sms_delete_team_template", { p_id: id });
      if (error) throw new Error(error.message);
      return id;
    },
    // Строка уходит сразу; отказ базы возвращает её на место.
    onMutate: async (id) => {
      const key = smsTemplatesKey(tenantId);
      await qc.cancelQueries({ queryKey: key });
      const before = qc.getQueriesData<SmsTeamTemplate[]>({ queryKey: key });
      qc.setQueriesData<SmsTeamTemplate[]>({ queryKey: key }, (list) => list?.filter((x) => x.id !== id));
      return { before };
    },
    onError: (_e, _id, context) => {
      for (const [key, value] of context?.before ?? []) qc.setQueryData(key, value);
    },
    onSettled: changed,
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

/** Порядок шаблонов команды — как лёг список после ручки. Строки встают
 *  сразу, ответ базы — после. */
export function useReorderTeamTemplates(teamId: string | null) {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  const changed = useTemplatesChanged();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.rpc("sms_reorder_team_templates", {
        p_team_id: teamId ?? "",
        p_ids: ids,
      });
      if (error) throw new Error(error.message);
      return ids;
    },
    onMutate: async (ids) => {
      const key = [...smsTemplatesKey(tenantId), teamId];
      await qc.cancelQueries({ queryKey: key });
      const before = qc.getQueryData<SmsTeamTemplate[]>(key);
      if (before) {
        const rank = new Map(ids.map((id, index) => [id, index]));
        qc.setQueryData<SmsTeamTemplate[]>(
          key,
          before.map((x) => ({ ...x, position: rank.get(x.id) ?? x.position })),
        );
      }
      return { before };
    },
    onError: (_e, _ids, context) => {
      if (context?.before) qc.setQueryData([...smsTemplatesKey(tenantId), teamId], context.before);
    },
    onSettled: changed,
    meta: { errorHandled: true },
  });
}

/** История: вся или одной команды / одного события. */
export function useSmsHistory(limit = 50, filter?: { teamId?: string | null; trigger?: string | null }) {
  const tenantId = useTenantId();
  const role = useDataRole();
  const teamId = filter?.teamId ?? null;
  const trigger = filter?.trigger ?? null;
  return useQuery({
    queryKey: [...smsHistoryKey(tenantId), limit, teamId, trigger],
    enabled: !!tenantId && role.data === "owner",
    queryFn: async () => {
      const { data, error } = await supabase.rpc("sms_history", {
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

/** SMS записи — блок внизу страницы записи. */
export function useAppointmentSms(appointmentId: string | null | undefined) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: [...smsLogKey(tenantId), "appointment", appointmentId],
    enabled: !!tenantId && !!appointmentId,
    // Статусы («Доставлено», «Не доставлено») меняет сервер — при каждом
    // открытии записи и карточки блок перечитывается.
    staleTime: 0,
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

/** SMS клиента — блок на странице клиента. */
export function useClientSms(clientId: string | null | undefined, limit = 20) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: [...smsLogKey(tenantId), "client", clientId, limit],
    enabled: !!tenantId && !!clientId,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("sms_for_client", {
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

/** Оплата на сайте: функция открывает Stripe Checkout и отдаёт адрес.
 *  `autotopup` — эта оплата ещё и сохраняет карту: дальше баланс сам
 *  пополняется на ту же сумму, когда падает ниже порога (волна 13). */
export async function startSmsTopup(
  amountCents: number,
  returnUrl: string,
  autotopup?: { thresholdCents: number },
): Promise<string> {
  const { data, error } = await supabase.functions.invoke("sms-checkout", {
    body: {
      amount_cents: amountCents,
      return_url: returnUrl,
      ...(autotopup ? { autotopup: { threshold_cents: autotopup.thresholdCents } } : null),
    },
  });
  if (error) throw new Error(error.message);
  const url = (data as { url?: string } | null)?.url;
  if (!url) throw new Error("Оплата не открылась");
  return url;
}
