import { Linking, Platform } from "react-native";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Json } from "@babun/shared/db/database.types";
import { supabase } from "@/lib/supabase";
import { tenantBoundClient } from "@/lib/tenant-bound-client";
import { useTenantId } from "@/lib/tenant";
import { useDataRole } from "@/features/settings/tenant";
import { useAccountScope } from "@/features/cabinet/account-scope";
import { TENANT_HEADER } from "@/lib/tenant-header";
import {
  applyPatch,
  checkoutErrorText,
  parseSmsAccount,
  parseSmsHistory,
  parseSmsRecordLog,
  type SmsAccount,
  type SmsHistoryItem,
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

/** Шаблоны команды (`teamId`) или всех видимых команд (`null`). */
export function useTeamTemplates(teamId: string | null, cardTenantId?: string | null) {
  const activeTenantId = useTenantId();
  const role = useDataRole();
  // Шаблоны команды СВОЕЙ компании карточки (03.10): пока в календаре открыта
  // команда партнёра, команда клиента — не из активной компании, и чтение без
  // её заголовка возвращало пустой список («Шаблонов пока нет»).
  const tenantId = cardTenantId ?? activeTenantId;
  return useQuery({
    queryKey: [...smsTemplatesKey(tenantId), teamId],
    enabled: !!tenantId && role.isSuccess && role.data != null,
    queryFn: async () => {
      const { data, error } = await clientOf(cardTenantId, activeTenantId).rpc("sms_team_templates", {
        p_team_id: teamId ?? undefined,
      });
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

/** Клиент Supabase компании карточки: вкладка «Клиенты» открывает и
 *  клиентов компании-работодателя (`?tenant=`), и их SMS читаются и меняются
 *  под её заголовком, а не под активной компанией устройства. */
function clientOf(cardTenantId: string | null | undefined, activeTenantId: string | null) {
  return cardTenantId && cardTenantId !== activeTenantId ? tenantBoundClient(cardTenantId) : supabase;
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
      void qc.invalidateQueries({ queryKey: ["clients"] });
      void qc.invalidateQueries({ queryKey: ["client", input.clientId] });
    },
    meta: { errorHandled: true },
  });
}

/** Куда Stripe вернёт человека, платившего из приложения: страница
 *  «Оплата прошла» на сайте (без входа). */
export const SMS_PAY_DONE_URL = "https://babun.app/pay/done";

/** ОПЛАТА — ОТДЕЛЬНОЙ СТРАНИЦЕЙ STRIPE, НЕ ЧЕРЕЗ APPLE (владелец 30.09:
 *  «кнопка должна вести на пополнение через отдельную страницу… оплату
 *  полноценно, просто и легко для клиента»). На сайте страница открывается в
 *  той же вкладке и возвращает в Кабинет → SMS; в приложении — в браузере,
 *  а после возврата экран сам перечитывает баланс. */
export async function openSmsCheckout(
  amountCents: number,
  autotopup?: { thresholdCents: number },
  /** Аккаунт, ЧЕЙ баланс пополняют (блок аккаунта в Кабинете), — явно, а не
   *  тот, что открыт на телефоне (04.10). */
  tenantId?: string | null,
): Promise<void> {
  const web = Platform.OS === "web" && typeof window !== "undefined";
  const back = web ? `${window.location.origin}/cabinet/sms` : SMS_PAY_DONE_URL;
  const url = await startSmsTopup(amountCents, back, autotopup, tenantId);
  if (web) window.location.assign(url);
  else await Linking.openURL(url);
}

/** Оплата на сайте: функция открывает Stripe Checkout и отдаёт адрес.
 *  `autotopup` — эта оплата ещё и сохраняет карту: дальше баланс сам
 *  пополняется на ту же сумму, когда падает ниже порога (волна 13). */
export async function startSmsTopup(
  amountCents: number,
  returnUrl: string,
  autotopup?: { thresholdCents: number },
  tenantId?: string | null,
): Promise<string> {
  const { data, error } = await supabase.functions.invoke("sms-checkout", {
    body: {
      amount_cents: amountCents,
      return_url: returnUrl,
      ...(autotopup ? { autotopup: { threshold_cents: autotopup.thresholdCents } } : null),
    },
    ...(tenantId ? { headers: { [TENANT_HEADER]: tenantId } } : null),
  });
  if (error) throw new Error(await checkoutFailure(error));
  const url = (data as { url?: string } | null)?.url;
  if (!url) throw new Error(checkoutErrorText(null));
  return url;
}

/** Отказ функции оплаты словами: код лежит в теле ответа (`{ error }`),
 *  а сообщение самого клиента — «Edge Function returned a non-2xx…». */
async function checkoutFailure(error: unknown): Promise<string> {
  const e = error as { name?: string; context?: { clone?: () => { json: () => Promise<unknown> } } };
  if (e.name === "FunctionsFetchError") return checkoutErrorText(null, true);
  let code: string | null = null;
  try {
    const body = (await e.context?.clone?.().json()) as { error?: unknown } | undefined;
    if (typeof body?.error === "string") code = body.error;
  } catch {
    // тело не JSON — общие слова
  }
  return checkoutErrorText(code);
}
