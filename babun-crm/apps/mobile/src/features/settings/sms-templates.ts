import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { Json } from "@babun/shared/db/database.types";
import {
  KIND_LABELS,
  renderTemplate,
  type SmsTemplate,
  type TemplateKind,
} from "@babun/shared/local/sms-templates";
import { debtReminderSms } from "@babun/shared/common/utils/messenger-links";
import { getStorage } from "@babun/shared/storage";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";

export type { SmsTemplate, TemplateKind } from "@babun/shared/local/sms-templates";

// SMS-шаблоны не имеют собственной таблицы: на вебе они живут в
// localStorage и бэкапятся kitchen-sink-блобом в
// `tenant_state.prototype_state.smsTemplates` (v505). Мобилка использует
// этот же блоб как канонический источник (кросс-девайс с вебом), а MMKV —
// как офлайн-кэш по тому же ключу, что и web localStorage. Пишем через
// fetch→merge→upsert только ключ smsTemplates, чтобы не затирать
// остальные поля блоба (masters/teams/services/…).
//
// NB: shared/local/sms-templates.ts loadTemplates/saveTemplates ходят в
// window.localStorage напрямую (не через storage seam) — на нативе это
// no-op, поэтому кэш реализован здесь через getStorage() (MMKV).

const CACHE_KEY = "babun-sms-templates"; // = web STORAGE_KEY (префикс babun- попадает под wipe)

const VALID_KINDS = new Set<string>(Object.keys(KIND_LABELS));

function sanitize(list: unknown): SmsTemplate[] {
  if (!Array.isArray(list)) return [];
  const out: SmsTemplate[] = [];
  for (const raw of list) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.body !== "string") continue;
    const kind = VALID_KINDS.has(String(r.kind))
      ? (r.kind as TemplateKind)
      : "new_appointment";
    out.push({
      id: r.id,
      kind,
      name: typeof r.name === "string" ? r.name : KIND_LABELS[kind],
      body: r.body,
      enabled: r.enabled !== false,
    });
  }
  return out;
}

function loadCache(): SmsTemplate[] {
  return sanitize(getStorage().get<SmsTemplate[]>(CACHE_KEY));
}

function saveCache(list: SmsTemplate[]): void {
  getStorage().set(CACHE_KEY, list);
}

type Blob = Record<string, unknown>;

async function fetchBlob(tenantId: string): Promise<Blob | null> {
  const { data, error } = await supabase
    .from("tenant_state")
    .select("prototype_state")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const state = data?.prototype_state;
  return state && typeof state === "object" && !Array.isArray(state)
    ? (state as Blob)
    : null;
}

export function useSmsTemplates() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: ["sms-templates", tenantId],
    queryFn: async (): Promise<SmsTemplate[]> => {
      if (tenantId) {
        try {
          const blob = await fetchBlob(tenantId);
          // Ключ отсутствует вовсе → блоб ещё не писался с шаблонами,
          // оставляем девайсный кэш. Явный [] уважаем (v662 data-loss
          // guard): пользователь мог намеренно удалить все шаблоны.
          if (blob && "smsTemplates" in blob) {
            const list = sanitize(blob.smsTemplates);
            saveCache(list);
            return list;
          }
        } catch {
          // офлайн / RLS — ниже девайсный кэш
        }
      }
      return loadCache();
    },
  });
}

export function useSaveSmsTemplates() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (list: SmsTemplate[]) => {
      saveCache(list); // девайс первым — офлайн-безопасность
      if (!tenantId) {
        // Кэш записан (не потеряется), но канонический блоб — нет:
        // «Шаблон сохранён» здесь было бы враньём кросс-девайс.
        throw new Error("Нет подключения к аккаунту — попробуйте позже");
      }
      // merge, не replace: web держит в этом блобе ещё 9 сущностей.
      const blob = (await fetchBlob(tenantId)) ?? {};
      const { error } = await supabase.from("tenant_state").upsert(
        {
          tenant_id: tenantId,
          prototype_state: { ...blob, smsTemplates: list } as unknown as Json,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id" },
      );
      if (error) throw new Error(error.message);
      return list;
    },
    onSuccess: (list) => qc.setQueryData(["sms-templates", tenantId], list),
    meta: { errorHandled: true }, // экран алертит сам
  });
}

// C1 — текст «SMS о долге» из пользовательского шаблона kind=debt.
// Берём первый включённый непустой debt-шаблон, рендерим его с
// [Имя]/[Сумма] (renderTemplate маппит на Name/Amount). Если такого
// шаблона нет — фолбэк на зашитый debtReminderSms (единый источник).
//
// Область debt-шаблона намеренно узкая: поддерживаются ТОЛЬКО [Имя] и
// [Сумма]. opts.visitDate прокидывается лишь в фолбэк (в палитре нет
// токена даты визита) — как только оператор заводит свой debt-шаблон,
// дата визита в напоминание не попадает. Любой посторонний токен из
// общей палитры ([Услуга], [Дата], …) renderTemplate оставит сырым
// «[…]» литералом — это осознанный паттерн (ср. chats/[id].tsx): SMS
// открывается черновиком в Сообщениях, оператор дописывает перед
// отправкой. Расширять контекст здесь нельзя без синхронного сужения
// палитры токенов для kind=debt в редакторе (иначе «Тест» в редакторе
// покажет одно, а клиенту уйдёт другое).
export function renderDebtSms(
  templates: SmsTemplate[],
  opts: { amount: string; name?: string | null; visitDate?: string | null },
): string {
  const tpl = templates.find(
    (x) => x.kind === "debt" && x.enabled && x.body.trim(),
  );
  if (tpl) {
    // Только Name/Amount: visitDate и прочие токены сюда не маппятся —
    // см. комментарий выше (узкая область debt-шаблона).
    return renderTemplate(tpl.body, {
      Name: opts.name?.trim() || "",
      Amount: opts.amount,
    });
  }
  return debtReminderSms(opts);
}
