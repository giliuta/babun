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
import { useCurrentRole } from "@/features/settings/tenant";
import {
  isConfirmedNetworkUnavailable,
  isMissingSmsTemplatesContract,
  type ServerReadError,
} from "@/features/settings/server-read-fallback";

export type { SmsTemplate, TemplateKind } from "@babun/shared/local/sms-templates";

// SMS-шаблоны исторически лежат одним ключом внутри kitchen-sink блоба
// tenant_state.prototype_state. Мобильный клиент НИКОГДА не читает весь
// блоб: узкие RPC отдают/пишут только smsTemplates и атомарно сохраняют все
// соседние legacy-ключи. MMKV остаётся офлайн-кэшем.
//
// NB: shared/local/sms-templates.ts loadTemplates/saveTemplates ходят в
// window.localStorage напрямую (не через storage seam) — на нативе это
// no-op, поэтому кэш реализован здесь через getStorage() (MMKV).

const cacheKey = (tenantId: string) => `babun-sms-templates:${tenantId}`;

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

function loadCache(tenantId: string): SmsTemplate[] {
  return sanitize(getStorage().get<SmsTemplate[]>(cacheKey(tenantId)));
}

function saveCache(tenantId: string, list: SmsTemplate[]): void {
  getStorage().set(cacheKey(tenantId), list);
}

async function fetchTemplates(): Promise<{
  present: boolean;
  templates: SmsTemplate[];
}> {
  const { data, error } = await supabase.rpc("read_sms_templates_safe");
  if (error) throw error;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Сервер вернул некорректные SMS-шаблоны");
  }
  const result = data as Record<string, unknown>;
  return {
    present: result.present === true,
    templates: sanitize(result.templates),
  };
}

export function useSmsTemplates() {
  const tenantId = useTenantId();
  const roleQuery = useCurrentRole();
  const role = roleQuery.data;
  return useQuery({
    queryKey: ["sms-templates", tenantId, role ?? "role-pending"],
    enabled:
      !!tenantId &&
      roleQuery.isSuccess &&
      (role === "owner" || role === "dispatcher"),
    queryFn: async (): Promise<SmsTemplate[]> => {
      if (tenantId) {
        try {
          const remote = await fetchTemplates();
          // Ключ отсутствует вовсе → блоб ещё не писался с шаблонами,
          // оставляем девайсный кэш. Явный [] уважаем (v662 data-loss
          // guard): пользователь мог намеренно удалить все шаблоны.
          if (remote.present) {
            saveCache(tenantId, remote.templates);
            return remote.templates;
          }
        } catch (caught) {
          const error = caught as ServerReadError;
          if (
            !isConfirmedNetworkUnavailable(error) &&
            !isMissingSmsTemplatesContract(error)
          ) {
            throw caught;
          }
          // Confirmed offline or a rolling-deploy RPC gap: below, use the
          // tenant-scoped device cache. RLS/validation errors stay visible.
        }
      }
      return loadCache(tenantId as string);
    },
  });
}

export function useSaveSmsTemplates() {
  const tenantId = useTenantId();
  const role = useCurrentRole().data;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (list: SmsTemplate[]) => {
      if (role !== "owner" && role !== "dispatcher") {
        throw new Error("SMS-шаблоны доступны владельцу и диспетчеру.");
      }
      if (!tenantId) {
        throw new Error("Нет подключения к аккаунту — попробуйте позже");
      }
      const { error } = await supabase.rpc("write_sms_templates_safe", {
        p_templates: list as unknown as Json,
      });
      if (error) throw new Error(error.message);
      // Never show an RLS/validation/server failure as a locally saved value.
      // The cache mirrors a confirmed server write; it is not an outbox.
      saveCache(tenantId, list);
      return list;
    },
    onSuccess: (list) =>
      qc.setQueryData(
        ["sms-templates", tenantId, role ?? "role-pending"],
        list,
      ),
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
