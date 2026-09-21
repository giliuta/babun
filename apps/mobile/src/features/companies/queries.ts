import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Database } from "@babun/shared/db/database.types";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";

// ЮРЛИЦА КОМПАНИИ — СПРАВОЧНИК, КАК УСЛУГИ.
//
// Владелец 2026-09-20: «в одном приложении я могу управлять несколькими
// компаниями… создай страницу, блок компании — по сути она будет выглядеть
// так же, как услуги, только информация другая; когда я выставляю чек, я могу
// выбрать компанию либо сразу добавить новую».
//
// ЭТО НЕ «МОИ КОМПАНИИ» ИЗ КАБИНЕТА. Там — арендаторы, к которым человек
// приписан (его роли и календари). Здесь — ЮРЛИЦА ОДНОГО арендатора, от
// имени которых печатают бумаги. Слово одно, сущности разные, и путать их
// нельзя: первое про доступ, второе про подпись под документом.
//
// СКРЫТЬ И УДАЛИТЬ — ДВА РАЗНЫХ ДЕЙСТВИЯ (владелец 2026-09-22: «вправо
// сдвинуть — удалить, влево — скрывать, чтоб оно больше не показывалось»).
// Скрытый набор (`archived_at`) пропадает из выбора в чеке и инвойсе, но
// живёт в справочнике серой строкой. Удалённый уходит совсем — бумаге это не
// вредит: и чек, и инвойс печатают продавца из СВОЕГО снимка
// (`seller_snapshot`), а не из живой строки.

export type Company = Database["public"]["Tables"]["companies"]["Row"];
export type CompanyDraft = Omit<
  Database["public"]["Tables"]["companies"]["Insert"],
  "tenant_id"
>;

export const companiesQueryKey = (tenantId: string | null) => ["companies", tenantId];

export function useCompanies() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: companiesQueryKey(tenantId),
    enabled: !!tenantId,
    queryFn: async (): Promise<Company[]> => {
      const { data, error } = await supabase
        .from("companies")
        .select("*")
        .eq("tenant_id", tenantId as string)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
}

/** Юрлицо, которое подставляют документы: помеченное умолчанием, а если
 *  такого нет — первое живое. Пустой список означает «справочник ещё не
 *  завели», и документ печатает реквизиты арендатора, как до 20.09. */
export function defaultCompany(companies: readonly Company[]): Company | null {
  const live = companies.filter((c) => !c.archived_at);
  return live.find((c) => c.is_default) ?? live[0] ?? null;
}

export function useSaveCompany() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string | null; patch: CompanyDraft }) => {
      if (id) {
        // Фильтр по тенанту рядом с id — не потому, что RLS не держит, а
        // потому, что один слой защиты это один слой (аудит 2026-09-20).
        const { error } = await supabase
          .from("companies")
          .update(patch)
          .eq("id", id)
          .eq("tenant_id", tenantId as string);
        if (error) throw new Error(error.message);
        return id;
      }
      const { data, error } = await supabase
        .from("companies")
        .insert({ ...patch, tenant_id: tenantId as string })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["companies"] }),
    meta: { errorHandled: true },
  });
}

/** Переключение ОДНИМ движением, на сервере.
 *
 *  Здесь стояли два запроса подряд — снять старое умолчание, поставить новое,
 *  — и между ними у компании не было ни одного основного набора. Чек,
 *  выписанный в эту щель, подписывался «первым живым юрлицом по порядку», а
 *  не выбранным (аудит прав 2026-09-20). Дверь `set_default_company` делает
 *  оба шага в одной транзакции и сама проверяет, что компания твоя. */
export function useMakeDefaultCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("set_default_company", {
        p_company_id: id,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["companies"] }),
    meta: { errorHandled: true },
  });
}

export function useArchiveCompany() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => {
      const { error } = await supabase
        .from("companies")
        .update({ archived_at: archived ? new Date().toISOString() : null })
        .eq("id", id)
        .eq("tenant_id", tenantId as string);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["companies"] }),
    meta: { errorHandled: true },
  });
}

/** Удаление набора. Бумага от него не страдает: чек и инвойс печатают свой
 *  снимок, а их связь с набором при удалении обнуляется (`on delete set
 *  null`, миграция 20260922020000). */
export function useDeleteCompany() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("companies")
        .delete()
        .eq("id", id)
        .eq("tenant_id", tenantId as string);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["companies"] }),
    meta: { errorHandled: true },
  });
}

/** Порядок — тот, что человек перетащил. Пишется только у строк, чьё место
 *  поменялось: наборов единицы, отдельный RPC ради этого не нужен. */
export function useReorderCompanies() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (moves: { id: string; position: number }[]) => {
      for (const move of moves) {
        const { error } = await supabase
          .from("companies")
          .update({ position: move.position })
          .eq("id", move.id)
          .eq("tenant_id", tenantId as string);
        if (error) throw new Error(error.message);
      }
    },
    // ПОРЯДОК ВИДЕН СРАЗУ: без этого отпущенная строка на секунду прыгала
    // на старое место и возвращалась, когда сервер отвечал. Ошибка —
    // откат к тому, что было.
    // СИНХРОННО, без `await`: ожидание отмены запросов отодвигало новый порядок
    // на кадры после отпускания, и строка успевала отпрыгнуть на старое место
    // (владелец 22.09: «рывок был»). Отмена уходит фоном, данные — сразу.
    onMutate: (moves) => {
      const key = companiesQueryKey(tenantId);
      void qc.cancelQueries({ queryKey: key });
      const before = qc.getQueryData<Company[]>(key);
      if (before) {
        const at = new Map(moves.map((m) => [m.id, m.position]));
        qc.setQueryData<Company[]>(
          key,
          before
            .map((c) => ({ ...c, position: at.get(c.id) ?? c.position }))
            .sort((a, b) => a.position - b.position),
        );
      }
      return { before };
    },
    onError: (_error, _moves, context) => {
      if (context?.before) qc.setQueryData(companiesQueryKey(tenantId), context.before);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["companies"] }),
    meta: { errorHandled: true },
  });
}
