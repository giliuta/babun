// finance_categories repository — read-only for the UI.
//
// Rows with tenant_id IS NULL are global defaults seeded in the
// 20260517_001 migration; per-tenant rows can override the slug.
// The list call returns BOTH so the UI can pick whichever is most
// specific. type ('income' / 'expense' / 'debt') is the primary filter.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";

// Третий вид — «debt». Владелец 2026-09-10: «под расход свои категории, под
// доход свои, под долги свои, они не смешиваются»: в списке поставщиков и
// займов «Бензину» делать нечего.
export type FinanceCategoryKind = "income" | "expense" | "debt";

export interface FinanceCategory {
  id: string;
  tenant_id: string | null; // null = global default
  slug: string;
  name: string;
  type: FinanceCategoryKind;
  icon: string | null;
  color: string | null;
  /** Тенант убрал строку из своего списка (finance_category_hidden). */
  hidden: boolean;
  /** Место в списке ЭТОГО тенанта (finance_category_order). Строки нет — ноль,
   *  дальше разводит имя: справочник, который не перетаскивали, выглядит как
   *  раньше. Позиция живёт отдельной таблицей, потому что сами категории
   *  глобальные и колонка в них переставила бы список всем компаниям. */
  position: number;
}

type DbSupabase = SupabaseClient<Database>;
type Row = Database["public"]["Tables"]["finance_categories"]["Row"];

function rowToCategory(
  r: Row,
  hidden = false,
  position = 0,
): FinanceCategory {
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    slug: r.slug,
    name: r.name,
    type: r.type as FinanceCategoryKind,
    icon: r.icon,
    color: r.color,
    hidden,
    position,
  };
}

/** Returns ALL categories visible to this tenant — globals + own.
 *  Скрытые тенантом строки приходят с hidden: true, а не пропадают: экран
 *  настроек должен их показать (чтобы вернуть), а выбор — отфильтровать. */
export async function listFinanceCategories(
  supabase: DbSupabase,
  tenantId: string,
): Promise<FinanceCategory[]> {
  const [list, hidden, order] = await Promise.all([
    supabase
      .from("finance_categories")
      .select("*")
      .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
      .order("type", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("finance_category_hidden")
      .select("category_id")
      .eq("tenant_id", tenantId),
    supabase
      .from("finance_category_order")
      .select("category_id, position")
      .eq("tenant_id", tenantId),
  ]);
  if (list.error) throw new Error(`listFinanceCategories: ${list.error.message}`);
  if (hidden.error) throw new Error(`listFinanceCategories: ${hidden.error.message}`);
  // Порядок необязателен: у справочника, который никто не перетаскивал, строк
  // нет вовсе, и это не ошибка чтения.
  const at = new Map(
    (order.data ?? []).map((r) => [r.category_id, r.position] as const),
  );
  const off = new Set((hidden.data ?? []).map((r) => r.category_id));
  return ((list.data ?? []) as Row[]).map((r) =>
    rowToCategory(r, off.has(r.id), at.get(r.id) ?? 0),
  );
}

/** Прячет/возвращает категорию в списке этого тенанта. */
export async function setFinanceCategoryHidden(
  supabase: DbSupabase,
  tenantId: string,
  categoryId: string,
  hidden: boolean,
): Promise<void> {
  const { error } = hidden
    ? await supabase
        .from("finance_category_hidden")
        .upsert(
          { tenant_id: tenantId, category_id: categoryId },
          { onConflict: "tenant_id,category_id" },
        )
    : await supabase
        .from("finance_category_hidden")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("category_id", categoryId);
  if (error) throw new Error(error.message);
}

export interface NewFinanceCategory {
  name: string;
  type: FinanceCategoryKind;
  icon?: string | null;
  color?: string | null;
}

/** Inserts a tenant-owned category. RLS (finance_categories_write_own)
 *  already permits authenticated tenant inserts; slug is auto-generated
 *  (unique, non-meaningful) since the human label lives in `name`. */
export async function insertFinanceCategory(
  supabase: DbSupabase,
  tenantId: string,
  draft: NewFinanceCategory,
): Promise<FinanceCategory> {
  const slug = `custom-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const { data, error } = await supabase
    .from("finance_categories")
    .insert({
      tenant_id: tenantId,
      slug,
      name: draft.name.trim(),
      type: draft.type,
      icon: draft.icon ?? "🏷️",
      color: draft.color ?? null,
    })
    .select("*")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Не удалось создать финансовую категорию");
  }
  return rowToCategory(data as Row);
}

export interface FinanceCategoryPatch {
  name?: string;
  icon?: string | null;
  color?: string | null;
}

/** Updates a tenant-owned category. RLS blocks edits to global defaults
 *  (tenant_id IS NULL), so the UI must only call this for own rows. */
export async function updateFinanceCategory(
  supabase: DbSupabase,
  id: string,
  patch: FinanceCategoryPatch,
): Promise<void> {
  const update: Partial<Database["public"]["Tables"]["finance_categories"]["Update"]> = {};
  if (patch.name !== undefined) update.name = patch.name.trim();
  if (patch.icon !== undefined) update.icon = patch.icon;
  if (patch.color !== undefined) update.color = patch.color;
  const { data, error } = await supabase
    .from("finance_categories")
    .update(update)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    throw new Error(error?.message ?? "Категория не найдена или недоступна");
  }
}

/** Deletes a tenant-owned category. Transactions/templates referencing it
 *  keep working — category_id FKs are ON DELETE SET NULL. */
export async function deleteFinanceCategory(
  supabase: DbSupabase,
  id: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("finance_categories")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    throw new Error(error?.message ?? "Категория не найдена или недоступна");
  }
}

/** ПОРЯДОК СПРАВОЧНИКА — РУКОЙ ВЛАДЕЛЬЦА И ТОЛЬКО ЕГО ТЕНАНТА. Пишем разом:
 *  перетаскивание меняет позиции всей видимой пачки, и построчная запись
 *  оставила бы список наполовину переставленным при обрыве связи. */
export async function setFinanceCategoryOrder(
  supabase: DbSupabase,
  tenantId: string,
  orderedIds: readonly string[],
): Promise<void> {
  if (orderedIds.length === 0) return;
  const { error } = await supabase.from("finance_category_order").upsert(
    orderedIds.map((category_id, position) => ({
      tenant_id: tenantId,
      category_id,
      position,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "tenant_id,category_id" },
  );
  if (error) throw new Error(`setFinanceCategoryOrder: ${error.message}`);
}
