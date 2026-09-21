import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

// КЛИЕНТЫ СЛУШАЮТСЯ УРОВНЕЙ — СТОРОЖ ПРАВИЛА (STORY-082, владелец 19.09).
//
// Миграция `clients_access_levels_live` накатана и проверена прогоном в
// откате; сторож внутри неё отрабатывает ОДИН раз, на накате. Этот тест —
// вторая линия: он падает, когда кто-то перепишет правило позже, в другой
// миграции или в экране, и открытая база уедет не туда.
//
// Проверяется ТЕКСТ условий целиком (пробелы схлопнуты), а не наличие меток:
// «includes('clients')» пропускал бы и «or true», и «write» вместо «read».

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(here, "../../../../../supabase/migrations");
const MIGRATION = "20260919230000_clients_access_levels_live.sql";
const SCREENS = resolve(here, "../../../app/(dashboard)/clients");

const migration = readFileSync(join(MIGRATIONS_DIR, MIGRATION), "utf8");

/** Один пробел между словами, без строк-комментариев: объяснение не имеет
 *  права ни удовлетворять проверку, ни ломать её. Снимаются ТОЛЬКО строки,
 *  начинающиеся с «--»: внутри этой миграции есть код в E-строках, и там «--»
 *  — часть тела функции, а не комментарий файла. */
function norm(sql: string): string {
  return sql
    .replace(/^\s*--[^\n]*$/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

const flat = norm(migration);

function definesFunction(sql: string, fn: string): boolean {
  return new RegExp(String.raw`create\s+or\s+replace\s+function\s+public\.${fn}\s*\(`, "i").test(sql);
}

/** Последняя миграция, которая переопределяет функцию. */
function lastDefiner(fn: string): string {
  const files = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();
  let last = "";
  for (const file of files) {
    if (definesFunction(readFileSync(join(MIGRATIONS_DIR, file), "utf8"), fn)) last = file;
  }
  return last;
}

describe("сервер: клиенты по уровням", () => {
  test("правило видимости и окно живут в этой миграции и не переписаны позже", () => {
    for (const fn of [
      "access_client_ids",
      "access_company_level",
      "list_member_clients",
      "client_seen_by_caller",
      "client_without_contacts",
      "client_without_money",
      "current_user_can_edit_client",
    ]) {
      assert.equal(lastDefiner(fn), MIGRATION, `${fn} переопределён позже`);
    }
  });

  test("сотрудник не читает таблицу клиентов: правила — только владельцу", () => {
    const owner = " tenant_id = (select public.current_tenant_id()) and (select public.current_user_role()) = 'owner'";
    for (const policy of [
      "create policy clients_select_owner on public.clients for select to authenticated using (",
      "create policy clients_update_owner on public.clients for update to authenticated using (",
      "create policy clients_insert_owner on public.clients for insert to authenticated with check (",
      "create policy client_tag_assignments_select_owner on public.client_tag_assignments for select to authenticated using (",
    ]) {
      const at = flat.indexOf(policy);
      assert.ok(at >= 0, `нет правила: ${policy}`);
      assert.ok(
        flat.slice(at + policy.length, at + policy.length + 200).startsWith(owner),
        `правило пускает не только владельца: ${policy}`,
      );
    }
    assert.ok(
      !/create policy clients_[a-z_]+ on public\.clients[\s\S]{0,400}access_client_ids/.test(flat),
      "правило таблицы пускает сотрудника мимо окна",
    );
  });

  test("метки компании видит тот, кому открыли клиентов", () => {
    assert.ok(
      flat.includes(
        "create policy client_tags_select_access on public.client_tags for select to authenticated using ( tenant_id = (select public.current_tenant_id()) and ( (select public.current_user_role()) = 'owner' or (select public.access_company('clients', 'read')) ) )",
      ),
      "правило меток разошлось с блоком «Клиенты»",
    );
  });

  test("набор сотрудника: «все» или его календари, его записи и им созданные", () => {
    assert.ok(flat.includes("if not public.access_company('clients', 'read') then return array[]::uuid[]; end if;"));
    assert.ok(flat.includes("scope_level := public.access_company_level('clients.scope');"));
    assert.ok(
      flat.includes(
        "and array_position( array['read', 'write'], public.access_records_level(active_tenant, caller, mc.team_id) ) is not null",
      ),
      "календарь без «Календаря и записей» всё ещё отдаёт клиентов",
    );
    assert.ok(
      flat.includes(
        "scope_level = 'all' or c.created_by = caller or exists ( select 1 from public.appointments a where a.tenant_id = active_tenant and a.client_id = c.id and (a.team_id = any(calendars) or a.master_id = any(own_masters)) )",
      ),
      "правило «какие клиенты» переписано",
    );
    // Внутри ИМЕННО этого тела: «deleted_at is null» стоит и в окне, и
    // совпадение там ничего не сказало бы про набор.
    const at = flat.indexOf("create or replace function public.access_client_ids()");
    assert.ok(at >= 0);
    const body = flat.slice(at, flat.indexOf("comment on function public.access_client_ids()"));
    assert.ok(body.includes("and c.deleted_at is null"), "в набор попали корзина и архив");
  });

  test("окно прячет деньги всегда, контакты — по уровню, корзину — всем", () => {
    assert.ok(flat.includes("hide_contacts := not public.access_company('clients.contacts', 'read');"));
    assert.ok(flat.includes("hide_money := caller_role <> 'owner';"));
    assert.ok(flat.includes("select case when hide_money then public.client_without_money(shown.row_json) else shown.row_json end"));
    assert.ok(flat.includes("when hide_contacts then public.client_without_contacts(r.row_json)"));
    const window = flat.slice(
      flat.indexOf("create or replace function public.list_member_clients(p_client_id uuid default null)"),
      flat.indexOf("comment on function public.list_member_clients(uuid)"),
    );
    assert.ok(window.includes("and c.deleted_at is null"), "окно отдаёт корзину и архив");
    assert.ok(
      flat.includes("select p_client || jsonb_build_object('balance', 0, 'discount', 0)"),
      "пустые деньги перестали быть пустыми",
    );
  });

  test("сотрудник не трогает корзину, деньги и общие пометки", () => {
    // Правки вставляются в живое тело функции строкой, поэтому проверяем их
    // внутри блока подстановки, а не «где-нибудь в файле»: те же слова стоят
    // и в стороже, и совпадение там ничего бы не значило.
    const patch = (step: string) => {
      const at = flat.indexOf(`'${step}',`);
      assert.ok(at >= 0, `нет шага подстановки ${step}`);
      return flat.slice(at, at + 1800);
    };
    const update = patch("update_client_with_tags', 'employee");
    assert.ok(
      update.includes("if p_patch ?| array[''deleted_at'', ''balance'', ''discount'', ''blacklisted'',"),
      "список полей владельца в правке клиента изменился",
    );
    assert.ok(update.includes("''pinned_at'', ''favorite_master_id''] then"));
    assert.ok(
      update.includes("if not public.access_company(''clients.contacts'', ''read'')"),
      "правка контактов перестала спрашивать уровень",
    );
    assert.ok(
      update.includes("''instagram_username'', ''phones'', ''phone_e164''] then"),
      "скрытые контакты снова можно затереть",
    );
    const create = patch("create_client_with_tags', 'money");
    for (const line of [
      "input_row.balance := 0;",
      "input_row.discount := 0;",
      "input_row.deleted_at := null;",
      "input_row.blacklisted := false;",
    ]) {
      assert.ok(create.includes(line), `новый клиент сотрудника снова несёт: ${line}`);
    }
  });

  test("право править клиента спрашивает компанию, уровень и набор", () => {
    const at = flat.indexOf("create or replace function public.current_user_can_edit_client(p_client_id uuid)");
    assert.ok(at >= 0);
    const body = flat.slice(at, at + 700);
    assert.ok(body.includes("where c.id = p_client_id and c.tenant_id = public.current_tenant_id()"));
    assert.ok(body.includes("else public.access_company('clients', 'write') and p_client_id = any(public.access_client_ids())"));
    assert.ok(!/dispatcher|current_user_calendar_ids/.test(body), "вернулась старая ветка роли");
  });

  test("колонка автора заводится в два шага — без прошитого умолчания", () => {
    assert.ok(flat.includes("alter table public.clients add column if not exists created_by uuid references auth.users (id) on delete set null;"));
    assert.ok(flat.includes("alter table public.clients alter column created_by set default auth.uid();"));
    assert.ok(
      !/add column if not exists created_by[^;]*default/.test(flat),
      "умолчание вернулось в `add column` и пропишется существующим строкам",
    );
  });

  test("живы три блока клиентов", () => {
    for (const key of ["clients", "clients.scope", "clients.contacts"]) {
      assert.ok(
        flat.includes(`set live = true, enforced_by = array[`) && flat.includes(`where key = '${key}';`),
        `блок ${key} не объявлен живым`,
      );
    }
  });
});

describe("экраны: вкладка «Клиенты» открывается источником, а не ролью", () => {
  const read = (file: string) => readFileSync(join(SCREENS, file), "utf8");

  test("у вкладки нет границы по роли", () => {
    const layout = read("_layout.tsx");
    assert.ok(!layout.includes("RoleCapabilityBoundary"), "вернулась граница роли");
    assert.ok(!layout.includes("canAccessClientPath"), "вернулась дорога по адресу");
  });

  test("каждый экран вкладки проходит через ворота источника", () => {
    for (const file of [
      "index.tsx",
      "[id].tsx",
      "archive.tsx",
      "trash.tsx",
      "tags.tsx",
      "settings.tsx",
      "card-fields.tsx",
      "visits.tsx",
      "attachments.tsx",
    ]) {
      const source = read(file);
      assert.ok(source.includes("<ClientsCompanyRoute"), `${file} открывается мимо ворот источника`);
    }
  });

  test("общий адрес из записи держит компанию календаря", () => {
    const door = readFileSync(resolve(here, "../../../app/(shared)/client.tsx"), "utf8");
    assert.match(door, /<ClientsCompanyRoute kind="card" forceActive>/);
  });

  // ВИЗУАЛ ВКЛАДКИ НЕ ЗАВИСИТ ОТ ТОГО, ЧТО ОТКРЫТО В КАЛЕНДАРЕ (владелец
  // 20.09: «у нас пропали шестерёнки сверху слева… визуал вообще не
  // меняется»). Первый заход гасил шестерёнку и аналитику, пока своя
  // компания не станет активной.
  test("шестерёнка и аналитика не смотрят на активную компанию", () => {
    const list = read("index.tsx");
    // Срез строго по разметке шапки: «ClientsFilterBar» стоит и в импортах,
    // поэтому якорь — сам тег, а не имя.
    const header = list.slice(list.indexOf("minHeight: 48"), list.indexOf("<ClientsFilterBar"));
    assert.ok(header.includes("Настройки клиентов"), "шапка списка не найдена");
    assert.ok(
      !/isActive/.test(header),
      "двери шапки снова закрыты тем, какая компания открыта в календаре",
    );
    assert.ok(
      header.includes("clientsSettingsHref()") && header.includes("clientsInsightsHref(scope)"),
      "шапка ведёт мимо правила источников",
    );
    assert.ok(
      !list.includes("useCurrentRole"),
      "список снова спрашивает роль в активной компании вместо источника",
    );
    // ДВЕРИ ШАПКИ НЕ ЗАВИСЯТ И ОТ ИСТОЧНИКА (владелец 20.09: «визуал целой
    // страницы мы полностью сохраняем»): шестерёнка и аналитика стоят всегда,
    // а что за ними — решает уже сама страница.
    assert.ok(
      !/\{caps\.manage[^}]*\?\s*\(?\s*<Pressable/.test(header),
      "двери шапки снова гаснут по правам",
    );
    // Футер на месте и гаснет, а не исчезает.
    assert.ok(
      /disabled=\{!caps\.create\}/.test(list),
      "кнопка «Создать клиента» снова исчезает вместо того, чтобы гаснуть",
    );
  });

  test("аналитика клиентов открывается в компании ссылки", () => {
    const insights = readFileSync(
      resolve(here, "../../../app/(dashboard)/cabinet/insights.tsx"),
      "utf8",
    );
    assert.ok(insights.includes("<ClientsCompanyRoute"), "аналитика мимо ворот источника");
    assert.ok(insights.includes("if (!tenant) return <InsightsScreen />"), "ссылка без компании обязана вести себя как раньше");
    const boundary = readFileSync(
      resolve(here, "../settings/CabinetRoleBoundary.tsx"),
      "utf8",
    );
    assert.ok(
      boundary.includes("cabinetScreenRole(role, screenTenantId, memberships.data)"),
      "Кабинет снова судит экран ролью в активной компании",
    );
  });

  test("хуки клиентов читают источник, а не активную компанию", () => {
    const queries = readFileSync(join(here, "queries.ts"), "utf8");
    for (const hook of ["useClients", "useClient", "useClientTags", "useCreateClient", "useArchiveClients"]) {
      const at = queries.indexOf(`export function ${hook}(`);
      assert.ok(at >= 0, `нет хука ${hook}`);
      const body = queries.slice(at, at + 900);
      assert.ok(body.includes("useQueryScope()"), `${hook} не спрашивает источник`);
      assert.ok(!body.includes("useTenantId()"), `${hook} снова берёт активную компанию`);
    }
  });
});
