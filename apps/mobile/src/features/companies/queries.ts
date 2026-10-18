import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Database } from "@babun/shared/db/database.types";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { useAccountScope } from "@/session/account-scope";

// ЮРЛИЦА КОМПАНИИ — СПРАВОЧНИК, КАК УСЛУГИ.
//
// В одном приложении можно управлять несколькими юрлицами; при выписке чека
// выбирают юрлицо или сразу добавляют новое.
//
// ЭТО НЕ «МОИ КОМПАНИИ» ИЗ КАБИНЕТА. Там — арендаторы, к которым человек
// приписан (его роли и календари). Здесь — ЮРЛИЦА ОДНОГО арендатора, от
// имени которых печатают бумаги. Слово одно, сущности разные, и путать их
// нельзя: первое про доступ, второе про подпись под документом.
//
// СКРЫТЬ И УДАЛИТЬ — ДВА РАЗНЫХ ДЕЙСТВИЯ (вправо — удалить, влево — скрыть).
// Скрытый набор (`archived_at`) пропадает из выбора в чеке и инвойсе, но
// живёт в справочнике серой строкой. Удалить можно только юрлицо без
// документов: у юрлица своя серия номеров, и она
// живёт в выпущенных бумагах — такое юрлицо только скрывают.
//
// Таблица — `legal_entities` (раньше `companies`); ключ кэша
// прежний, `["companies"]`, чтобы не трогать всех, кто его сбрасывает.

export type Company = Database["public"]["Tables"]["legal_entities"]["Row"];
export type CompanyDraft = Omit<
  Database["public"]["Tables"]["legal_entities"]["Insert"],
  "tenant_id"
>;

export const companiesQueryKey = (tenantId: string | null) => ["companies", tenantId];

export function useCompanies() {
  // Наборы АККАУНТА СТРАНИЦЫ: в блоке пригласившего аккаунта в
  // Кабинете — его реквизиты; вне Кабинета — открытого на телефоне, как было.
  const { tenantId, client } = useAccountScope();
  return useQuery({
    queryKey: companiesQueryKey(tenantId),
    enabled: !!tenantId,
    queryFn: async (): Promise<Company[]> => {
      const { data, error } = await client
        .from("legal_entities")
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
        // потому, что один слой защиты это один слой.
        const { error } = await supabase
          .from("legal_entities")
          .update(patch)
          .eq("id", id)
          .eq("tenant_id", tenantId as string);
        if (error) throw new Error(error.message);
        return id;
      }
      const { data, error } = await supabase
        .from("legal_entities")
        .insert({ ...patch, tenant_id: tenantId as string })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["companies"] });
      // Буквы и длина номера живут на наборе: следующий номер у реквизитов,
      // в шестерёнке и в новом инвойсе перечитывается сразу.
      void qc.invalidateQueries({ queryKey: ["invoices", tenantId, "next-number"] });
    },
    meta: { errorHandled: true },
  });
}

/** Переключение ОДНИМ движением, на сервере.
 *
 *  Два запроса подряд — снять старое умолчание, поставить новое, — оставили бы
 *  щель, где у компании нет основного набора: чек, выписанный в неё,
 *  подписывался бы «первым живым юрлицом по порядку», а не выбранным. Дверь `set_default_company` делает
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
        .from("legal_entities")
        .update({ archived_at: archived ? new Date().toISOString() : null })
        .eq("id", id)
        .eq("tenant_id", tenantId as string);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["companies"] }),
    meta: { errorHandled: true },
  });
}

/** Есть ли у юрлица выпущенные документы. Спрашивается ДО удаления: экран
 *  перед удалением передаёт умолчание другому набору, и отказ базы после
 *  этого оставил бы умолчание переехавшим зря. */
export async function companyHasDocuments(tenantId: string, id: string): Promise<boolean> {
  for (const table of ["invoices", "receipts"] as const) {
    const { count, error } = await supabase
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("company_id", id);
    if (error) throw new Error(error.message);
    if ((count ?? 0) > 0) return true;
  }
  return false;
}

/** Удаление набора — только без документов. У юрлица с выпущенными
 *  инвойсами или чеками их серия, и база его не отдаст (ссылка документов,
 *  миграция 20261001001000): отказ приходит словами, а не кодом ключа. */
export function useDeleteCompany() {
  const tenantId = useTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("legal_entities")
        .delete()
        .eq("id", id)
        .eq("tenant_id", tenantId as string);
      if (error?.code === "23503") {
        throw new Error("У юрлица есть выпущенные документы — его можно только скрыть.");
      }
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
          .from("legal_entities")
          .update({ position: move.position })
          .eq("id", move.id)
          .eq("tenant_id", tenantId as string);
        if (error) throw new Error(error.message);
      }
    },
    // ПОРЯДОК ВИДЕН СРАЗУ: без этого отпущенная строка на секунду прыгала
    // на старое место и возвращалась, когда сервер отвечал. Ошибка —
    // откат к тому, что было.
    // СИНХРОННО, без `await`: ожидание отмены запросов отодвинуло бы новый порядок
    // на кадры после отпускания, и строка успела бы отпрыгнуть на старое место.
    // Отмена уходит фоном, данные — сразу.
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
