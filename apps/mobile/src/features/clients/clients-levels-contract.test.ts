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
      "current_user_can_edit_client",
    ]) {
      assert.equal(lastDefiner(fn), MIGRATION, `${fn} переопределён позже`);
    }
  });

  // МАСКИРОВКУ МОЖНО ПЕРЕОПРЕДЕЛИТЬ — НО ТОЛЬКО ПРЯЧА НЕ МЕНЬШЕ. STORY-085
  // (2026-09-21) законно переписала оба помощника: номера людей клиента и
  // реквизиты компании теперь тоже прячутся. Сторож поэтому держит не имя
  // файла, а правило: последнее определение обнуляет КАЖДОЕ поле, которое
  // обнуляла миграция уровней. Ослабить — упадёт; усилить — можно.
  test("последнее определение маскировки прячет не меньше, чем прятало", () => {
    const required: Record<string, string[]> = {
      client_without_contacts: [
        "'phone', ''",
        "'whatsapp_phone', ''",
        "'email', ''",
        "'telegram_username', ''",
        "'instagram_username', ''",
        "'phones', '[]'::jsonb",
        "'phone_e164', null",
        // STORY-086: роль в связи («жена», «жилец») рассказывает о человеке
        // столько же, сколько номер, — маска гасит и связи.
        "'memberships', '[]'::jsonb",
      ],
      client_without_money: ["'balance', 0", "'discount', 0"],
    };
    for (const [fn, keys] of Object.entries(required)) {
      const file = lastDefiner(fn);
      const sql = norm(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
      const start = sql.search(
        new RegExp(String.raw`create or replace function public\.${fn}\s*\(`, "i"),
      );
      const body = sql.slice(start, sql.indexOf("$function$;", start));
      for (const key of keys) {
        assert.ok(body.includes(key), `${fn} в ${file} больше не прячет ${key}`);
      }
    }
  });

  // STORY-085 (2026-09-21): человек клиента — отдельный клиент, и его контакты
  // прячет его собственная строка тем же помощником. STORY-086 (2026-09-22)
  // добавила связи ТРЕТИЙ ключ — место: без него у вопроса «кто живёт в Вилле
  // 5» нет ответа. Свободным текстом ключ не стал: триггер сверяет место с
  // объектами самой карточки-группы, поэтому телефон внутри связи — мимо
  // маскировки — по-прежнему не провезти.
  const membershipsGuard = (() => {
    const file = lastDefiner("enforce_client_memberships");
    assert.ok(file, "функции enforce_client_memberships больше нет");
    const sql = norm(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    const start = sql.search(/create or replace function public\.enforce_client_memberships\s*\(/i);
    return { file, sql, body: sql.slice(start, sql.indexOf("$function$;", start)) };
  })();

  test("связь человека несёт карточку, роль и место — контакт в неё не спрятать", () => {
    const { file, sql, body } = membershipsGuard;
    assert.ok(
      body.includes(
        "new.memberships := coalesce(( select jsonb_agg( jsonb_strip_nulls(jsonb_build_object( 'group_id', d.group_id, 'role', d.role, 'location_id', d.location_id )) order by d.pos)",
      ),
      `${file}: связь больше не пересобирается из трёх ключей`,
    );
    assert.ok(
      body.includes("and l.value ->> 'id' = m.value ->> 'location_id'"),
      `${file}: место связи больше не сверяется с объектами карточки-группы — в третий ключ полезет свободный текст`,
    );
    assert.ok(
      body.includes("select distinct on (v.group_id, v.location_id)"),
      `${file}: дедуп идёт не по паре «карточка + место» — жилец двух вилл одной управляющей потеряет одну`,
    );
    assert.ok(
      sql.includes(
        "before insert or update of memberships on public.clients for each row execute function public.enforce_client_memberships()",
      ),
      `${file}: триггер связей не висит на clients`,
    );
  });

  // ЦЕЛЬ СВЯЗИ — ВНУТРИ НАБОРА СОТРУДНИКА (STORY-086, дыра 8 критика).
  // Право править спрашивается по правимой строке, а карточка-группа — строка
  // чужая: без этого правила сотрудник, зная uuid, привязал бы своего клиента
  // к карточке, которую ему не показывает уровень «Какие клиенты».
  test("сотрудник не привяжет клиента к карточке вне своего набора", () => {
    const { file, body } = membershipsGuard;
    assert.ok(
      body.includes("select coalesce(array_agg(seen.id::text), array[]::text[]) into seen_ids from unnest(public.access_client_ids()) as seen(id);"),
      `${file}: цель связи не сверяется с набором сотрудника`,
    );
    assert.ok(
      body.includes("hint = 'block:clients.scope'"),
      `${file}: отказ по набору потерял свой блок`,
    );
    // Судятся только НОВЫЕ цели: уже стоящую связь сотрудник обязан пронести
    // через правку имени, иначе один запрет запер бы всю карточку.
    assert.ok(
      body.includes("into kept from jsonb_array_elements(coalesce(old.memberships, '[]'::jsonb)) m;")
        && body.includes("into fresh from jsonb_array_elements(new.memberships) m where not (m.value ->> 'group_id' = any(kept));"),
      `${file}: правило судит все связи, а не только новые — правка карточки со старой связью запрётся`,
    );
  });

  // АРХИВ, СТИРАНИЕ И ИСЧЕЗНУВШИЙ ОБЪЕКТ (STORY-086, дыры 4 и 12). Архив — это
  // `update clients set deleted_at` прямо по таблице, стирание — `delete`: RPC,
  // к которой можно было бы прицепить правило, на этих дорогах нет, поэтому оно
  // висит триггерами у самой таблицы.
  test("архив и стирание карточки снимают связи, исчезнувший объект гасит место", () => {
    const detachFile = lastDefiner("detach_client_memberships");
    const placesFile = lastDefiner("clear_gone_membership_places");
    assert.ok(detachFile, "сторож снятия связей при архиве и стирании пропал");
    assert.ok(placesFile, "сторож гашения исчезнувшего места пропал");
    const detach = norm(readFileSync(join(MIGRATIONS_DIR, detachFile), "utf8"));
    const places = norm(readFileSync(join(MIGRATIONS_DIR, placesFile), "utf8"));
    assert.ok(
      detach.includes(
        "after update of deleted_at on public.clients for each row when (new.deleted_at is not null and old.deleted_at is null) execute function public.detach_client_memberships();",
      ),
      `${detachFile}: архив карточки больше не снимает связи у её людей`,
    );
    assert.ok(
      detach.includes(
        "after delete on public.clients for each row execute function public.detach_client_memberships();",
      ),
      `${detachFile}: стирание карточки оставляет висячий group_id навсегда`,
    );
    assert.ok(
      detach.includes("where m.value ->> 'group_id' <> old.id::text"),
      `${detachFile}: снимается не та связь`,
    );
    assert.ok(
      places.includes(
        "after update of locations on public.clients for each row execute function public.clear_gone_membership_places();",
      ),
      `${placesFile}: стёртая вилла оставляет у жильца место, которому неоткуда взять имя`,
    );
    assert.ok(
      places.includes("then m.value - 'location_id' else m.value end"),
      `${placesFile}: у исчезнувшего объекта снимается не только место`,
    );
  });

  // ЛЮДИ КАРТОЧКИ — ОДНА ДВЕРЬ (STORY-086). «Набор урезан — блока нет»:
  // третьего состояния «видно, но не всё» не остаётся, иначе у сотрудника
  // появится строка «жилец · (никого)».
  test("дверь людей карточки: набор, контакты, глаза вызывающего, не anon", () => {
    const file = lastDefiner("list_client_members");
    assert.ok(file, "функции list_client_members больше нет");
    const sql = norm(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    const start = sql.search(/create or replace function public\.list_client_members\s*\(/i);
    const body = sql.slice(start, sql.indexOf("$function$;", start));
    for (const [rule, why] of [
      ["not public.access_company('clients', 'read')", "блок «Клиенты» больше не спрашивается"],
      ["not public.access_company('clients.contacts', 'read')", "люди приходят без права на контакты"],
      ["public.access_company_level('clients.scope') is distinct from 'all'", "люди приходят при урезанном наборе"],
      ["visible := public.access_client_ids();", "набор сотрудника больше не читается"],
      ["if not (p_group_id = any(visible)) then", "карточка-группа не сверяется с набором"],
      ["public.client_seen_by_caller(", "люди приходят мимо глаз вызывающего"],
      ["and c.deleted_at is null", "в людях карточки архив и корзина"],
      [
        "and c.memberships @> jsonb_build_array( jsonb_build_object('group_id', p_group_id::text))",
        "люди карточки ищутся не по связи",
      ],
    ] as const) {
      assert.ok(body.includes(rule), `${file}: ${why}`);
    }
    // Новая функция по умолчанию исполнима для PUBLIC, то есть и для anon.
    assert.ok(
      sql.includes(
        "revoke all on function public.list_client_members(uuid) from public, anon, authenticated, service_role; grant execute on function public.list_client_members(uuid) to authenticated;",
      ),
      `${file}: дверь людей карточки открыта незашедшему`,
    );
    assert.ok(
      sql.includes(
        "create index if not exists clients_memberships_gin on public.clients using gin (memberships jsonb_path_ops);",
      ),
      `${file}: указателя по связям нет — «люди карточки» станут перебором базы`,
    );
  });

  // Маска гасит связи до `[]` — и этот пустой массив не должен записаться
  // обратно поверх настоящих связей (STORY-086).
  test("скрытые маской связи сотрудник не запишет обратно", () => {
    const file = lastDefiner("update_client_with_tags");
    const sql = norm(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    assert.ok(
      sql.includes(
        "if not public.access_company('clients.contacts', 'read') and p_patch ?| array['phone', 'whatsapp_phone', 'email', 'telegram_username', 'instagram_username', 'phones', 'phone_e164', 'memberships'] then",
      ),
      `${file}: связи выпали из списка ключей, запрещённых сотруднику без «Телефонов»`,
    );
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
    // Экран принимает стартовый период (с «Финансов» — месяц), поэтому
    // сверяется сама ветка «без компании — экран как есть», а не пропсы.
    assert.match(insights, /if \(!tenant\) return <InsightsScreen[ />]/, "ссылка без компании обязана вести себя как раньше");
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
