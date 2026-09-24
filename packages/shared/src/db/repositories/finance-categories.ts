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
  /** Команда, которой принадлежит категория (владелец 2026-09-24: «у каждой
   *  команды свой тип расходов, свой тип доходов»). `null` — только у
   *  служебных категорий сервера. */
  team_id: string | null;
  /** Команда убрала категорию из выбора; строка остаётся в справочнике. */
  hidden: boolean;
  /** Что категория спрашивает в операции (владелец 2026-09-24: «зарплата
   *  смотрит сотрудников, другая прикрепляет клиента»). Флажки независимы:
   *  у чаевых — и клиент, и мастер. */
  ask_employee: boolean;
  ask_client: boolean;
  /** Без фото чека операцию этой категории не сохранить. */
  require_receipt: boolean;
  /** Служебная: ею подписывает деньги сервер («Услуги» оплаты записи,
   *  «Возврат», «Излишек», «Недостача»). Человек её не выбирает и не видит
   *  в справочнике. */
  is_system: boolean;
  /** Бюджет на месяц (владелец 2026-09-24: «выставить бюджет по категории,
   *  и она пришлёт уведомление, что перевалил лимит»). `null` — бюджета нет.
   *  Потраченное считает приложение по журналу месяца. */
  monthly_budget: number | null;
  /** Место в списке своей команды (перетаскивание). Ноль — не
   *  перетаскивали, дальше разводит имя. */
  position: number;
}

type DbSupabase = SupabaseClient<Database>;
type Row = Database["public"]["Tables"]["finance_categories"]["Row"];

function rowToCategory(r: Row): FinanceCategory {
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    team_id: r.team_id ?? null,
    slug: r.slug,
    name: r.name,
    type: r.type as FinanceCategoryKind,
    icon: r.icon,
    color: r.color,
    hidden: Boolean(r.hidden),
    position: r.position ?? 0,
    ask_employee: Boolean(r.ask_employee),
    ask_client: Boolean(r.ask_client),
    require_receipt: Boolean(r.require_receipt),
    is_system: Boolean(r.is_system),
    monthly_budget: r.monthly_budget == null ? null : Number(r.monthly_budget),
  };
}

/** Все категории, видимые этому человеку: служебные сервера и категории
 *  команд компании (сотруднику RLS отдаёт только его команды). Скрытые
 *  приходят с `hidden: true`, а не пропадают: справочник должен их показать
 *  (чтобы вернуть), а выбор — отфильтровать. */
export async function listFinanceCategories(
  supabase: DbSupabase,
  tenantId: string,
): Promise<FinanceCategory[]> {
  const { data, error } = await supabase
    .from("finance_categories")
    .select("*")
    .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
    .order("type", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error(`listFinanceCategories: ${error.message}`);
  // ГОТОВЫЕ ОБЩИЕ КАТЕГОРИИ ВЫВЕДЕНЫ ИЗ ПРОДУКТА (20260924200000): строки в
  // базе остались, но у компании их больше нет — справочник у каждой свой.
  return ((data ?? []) as Row[]).filter((r) => !r.retired).map(rowToCategory);
}

/** Прячет/возвращает категорию в выборе её команды. */
export async function setFinanceCategoryHidden(
  supabase: DbSupabase,
  categoryId: string,
  hidden: boolean,
): Promise<void> {
  const { data, error } = await supabase
    .from("finance_categories")
    .update({ hidden })
    .eq("id", categoryId)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    throw new Error(error?.message ?? "Категория не найдена или недоступна");
  }
}

export interface NewFinanceCategory {
  /** Команда категории — обязательна: категория компании без команды не
   *  существует (`finance_categories_team_required`). */
  team_id: string;
  name: string;
  type: FinanceCategoryKind;
  icon?: string | null;
  color?: string | null;
  ask_employee?: boolean;
  ask_client?: boolean;
  require_receipt?: boolean;
  monthly_budget?: number | null;
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
      team_id: draft.team_id,
      slug,
      name: draft.name.trim(),
      type: draft.type,
      icon: draft.icon ?? null,
      color: draft.color ?? null,
      ask_employee: draft.ask_employee ?? false,
      ask_client: draft.ask_client ?? false,
      require_receipt: draft.require_receipt ?? false,
      monthly_budget: draft.monthly_budget ?? null,
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
  ask_employee?: boolean;
  ask_client?: boolean;
  require_receipt?: boolean;
  monthly_budget?: number | null;
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
  if (patch.ask_employee !== undefined) update.ask_employee = patch.ask_employee;
  if (patch.ask_client !== undefined) update.ask_client = patch.ask_client;
  if (patch.require_receipt !== undefined) update.require_receipt = patch.require_receipt;
  if (patch.monthly_budget !== undefined) update.monthly_budget = patch.monthly_budget;
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

/** ПОРЯДОК СПРАВОЧНИКА КОМАНДЫ — РУКОЙ ВЛАДЕЛЬЦА. Позиция — колонка самой
 *  категории: она и так своя у команды. Пишем всю пачку: перетаскивание меняет
 *  позиции всех видимых строк. */
export async function setFinanceCategoryOrder(
  supabase: DbSupabase,
  orderedIds: readonly string[],
): Promise<void> {
  const results = await Promise.all(
    orderedIds.map((id, position) =>
      supabase.from("finance_categories").update({ position }).eq("id", id),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw new Error(`setFinanceCategoryOrder: ${failed.error.message}`);
}
