// Team SMS templates: read, save, enable, delete, reorder.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { useDataRole } from "@/session/tenant";
import {
  draftPayload,
  parseTeamTemplate,
  parseTeamTemplates,
  type SmsTeamTemplate,
  type TemplateDraft,
} from "../sms-team-templates";
import {
  clientOf,
  smsAccountKey,
  smsLogKey,
  smsTemplatesKey,
} from "./keys";
import { toJson } from "@babun/shared/db/json";
import { NEVER_PAUSE } from "@/lib/never-pause";

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
    // Без сети запись падает ошибкой, а не встаёт на паузу: лист с
    // `useGuardedClose` ждёт конца записи и иначе не закрывался ничем (13.10).
    ...NEVER_PAUSE,
    mutationFn: async (draft: TemplateDraft): Promise<SmsTeamTemplate> => {
      const { data, error } = await supabase.rpc("sms_save_team_template", {
        p: toJson(draftPayload(draft)),
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
