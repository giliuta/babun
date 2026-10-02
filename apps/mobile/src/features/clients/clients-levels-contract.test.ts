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

// КЛИЕНТЫ ПО КОМАНДАМ (владелец 29.09): правило видимости переписано
// сознательно — «Клиенты», «Какие клиенты» и «Телефоны» стали правами команды.
// Сторож теперь держит НОВУЮ миграцию и её условия: видимость, телефоны и
// правка считаются по командам в паре с «Клиентами» этой же команды.
const PER_TEAM = "20260929160000_clients_rights_per_team.sql";
const perTeam = norm(readFileSync(join(MIGRATIONS_DIR, PER_TEAM), "utf8"));

// ЗАЩИТА БАЗЫ (владелец 30.09): списки сотрудника контактов не несут никогда,
// номер — дверью по одному клиенту; «Около записи» и «В день записи». Три
// функции переписаны сознательно — сторож держит их новые условия.
const ONE_BY_ONE = "20260930233000_clients_contacts_one_by_one.sql";
const oneByOne = norm(readFileSync(join(MIGRATIONS_DIR, ONE_BY_ONE), "utf8"));

// БЛОКИ КАРТОЧКИ (владелец 30.09: «страница клиентов по правам — полностью»):
// у каждого блока карточки своё право в команде; строка сотрудника — маской
// `client_masked_for_member` по положениям `access_client_blocks`.
const CARD_BLOCKS = "20260930234000_clients_card_blocks.sql";
const cardBlocks = norm(readFileSync(join(MIGRATIONS_DIR, CARD_BLOCKS), "utf8"));

// ОБХОДНЫЕ ДОРОГИ (аудит 30.09): SMS, чеки, копия записи, старые записи
// мастера — данные клиента не уходят мимо «номер по одному» и «Около записи».
const LEAKS = "20260930235950_clients_leak_paths.sql";
const leaks = norm(readFileSync(join(MIGRATIONS_DIR, LEAKS), "utf8"));

// «ГЛАВНОЕ» КЛИЕНТОВ (владелец 01.10): «Открывает карточку» гасит блоки
// страницы клиента, «Карточка из записи» — окно клиента записи. Обе функции
// переписаны сознательно — сторож держит их новые условия.
const OPEN_CARD = "20261001161500_clients_open_card_rights.sql";
const openCard = norm(readFileSync(join(MIGRATIONS_DIR, OPEN_CARD), "utf8"));

// «БАЗА КЛИЕНТОВ» — «СКРЫТА» ИЛИ «ТОЛЬКО ВИДИТ» (владелец 02.10): окно
// «2 недели» / «Месяц» едет с днём, блок карточки с «Меняет» правится сам,
// база (имя, номера) — только владельцу. Функции переписаны сознательно.
const BASE_READ = "20261002233700_clients_base_read_window.sql";
const baseRead = norm(readFileSync(join(MIGRATIONS_DIR, BASE_READ), "utf8"));

describe("сервер: клиенты по уровням", () => {
  test("правило видимости и окно живут в миграции «по командам» и не переписаны позже", () => {
    for (const fn of ["access_client_ids", "current_user_can_edit_client"]) {
      assert.equal(lastDefiner(fn), PER_TEAM, `${fn} переопределён позже`);
    }
    for (const fn of ["access_client_ids_in", "access_company_level", "access_client_blocks", "update_client_with_tags"]) {
      assert.equal(lastDefiner(fn), BASE_READ, `${fn} переопределён позже`);
    }
    for (const fn of [
      "list_master_appointments_safe",
      "sms_message_json",
      "sms_for_client",
      "sms_send_manual",
      "sms_appointment_link",
      "receipts_client_snapshot_no_phone",
      "member_client_in_team",
      "member_appointment_copy",
      "member_appointment_update",
    ]) {
      assert.equal(lastDefiner(fn), LEAKS, `${fn} переопределён позже`);
    }
    for (const fn of [
      "client_masked_for_member",
      "list_member_clients",
      "list_client_members",
      "client_seen_by_caller",
      "member_client_contacts",
      "create_client_with_tags",
    ]) {
      assert.equal(lastDefiner(fn), CARD_BLOCKS, `${fn} переопределён позже`);
    }
    for (const fn of ["list_master_clients_safe"]) {
      assert.equal(lastDefiner(fn), OPEN_CARD, `${fn} переопределён позже`);
    }
  });

  test("база — «Скрыта» или «Только видит», окно едет с днём, блок правится своим правом", () => {
    assert.ok(baseRead.includes("update public.member_access set level = 'read' where block = 'clients' and level = 'write';"));
    assert.ok(baseRead.includes("update public.access_blocks set levels = array['off', 'read'] where key = 'clients';"));
    assert.ok(baseRead.includes("update public.access_blocks set levels = array['near', 'month', 'own'] where key = 'clients.scope';"));
    // «2 недели» и «Месяц» до и после записи; отменённая окна не открывает.
    assert.ok(
      baseRead.includes(
        "and a.team_id = any(near_teams) and a.status is distinct from 'cancelled' and a.date between (today - 14)::text and (today + 14)::text",
      ),
    );
    assert.ok(
      baseRead.includes(
        "and a.team_id = any(month_teams) and a.status is distinct from 'cancelled' and a.date between (today - interval '1 month')::date::text and (today + interval '1 month')::date::text",
      ),
    );
    assert.ok(baseRead.includes("when 'month' = any(scope_levels) then 'month'"));
    // «Меняет» блока — своим правом, без «Меняет» у базы.
    assert.ok(baseRead.includes("when l.level = 'write' then 2 when l.level in ('read', 'write') then 1"));
    assert.ok(!baseRead.includes("when l.level = 'write' and tm.card_level = 'write' then 2"));
    // Правка — только видимого клиента, вход по «Видит».
    assert.ok(baseRead.includes("or not (active_role = 'owner' or public.access_company('clients', 'read')) then"));
    assert.ok(
      baseRead.includes(
        "and (p_client_id = any(public.access_client_ids_in(public.access_calendars('clients', 'read')))) is not true then raise exception 'client not found'",
      ),
    );
  });

  test("«Открывает карточку» и «Карточка из записи» — условия на сервере", () => {
    // Блоки страницы без «Открывает карточку» гаснут; ключ едет в `blocks`
    // (`access_client_blocks` с 02.10 живёт в миграции «база — только видит»).
    assert.ok(baseRead.includes("when k.block_key = any(page_only) and tm.open_level is distinct from 'write' then 0"));
    assert.ok(baseRead.includes("select tm.team_id, 'clients.open'::text, case when tm.open_level = 'write' then 2 else 0 end"));
    // Последняя запись стоит в строке списка — не гаснет; денег, метки и
    // тегов в строке нет (01.10) — они блоки страницы.
    assert.ok(
      baseRead.includes(
        "page_only constant text[] := array[ 'clients.note', 'clients.people', 'clients.objects', 'clients.personal', 'clients.files', 'clients.requisites', 'clients.money', 'clients.labels' ];",
      ),
    );
    // Клиент записи — только из команды, где открыт переход из записи, и
    // «Около записи» осталось на месте.
    assert.ok(openCard.includes("and a.team_id = any(ct.ids) and a.team_id = any(ct.door_ids)"));
    assert.ok(openCard.includes("and a.date between (cs.today - 7)::text and (cs.today + 1)::text"));
    // У тех, кто уже работает, ничего не пропадает.
    assert.ok(openCard.includes("'clients.open', mc.team_id, 'write'"));
    assert.ok(openCard.includes("'clients.from_record', mc.team_id, 'write'"));
  });

  test("блоки карточки: маска — контакты всегда, закрытые блоки пустые, у всех дверей одна", () => {
    // Маска начинается с контактов — номер не приходит ни при каком блоке.
    assert.ok(
      cardBlocks.includes(
        "select public.client_without_contacts(p_client) || case when coalesce(b.v ->> 'clients.note', 'off') = 'off' then jsonb_build_object('comment', '', 'notes', '[]'::jsonb) else '{}'::jsonb end",
      ),
      "маска карточки перестала гасить контакты или заметку",
    );
    for (const [block, blank] of [
      ["clients.objects", "jsonb_build_object('locations', '[]'::jsonb, 'equipment', '[]'::jsonb, 'address', '', 'property_type', '')"],
      ["clients.labels", "jsonb_build_object('city', '', 'city_manual', false, 'tag_ids', '[]'::jsonb)"],
      ["clients.requisites", "jsonb_build_object('legal_name', null, 'vat_number', null, 'reg_number', null, 'billing_address', null, 'requisites', '[]'::jsonb)"],
      ["clients.money", "jsonb_build_object('balance', 0, 'discount', 0)"],
    ] as const) {
      assert.ok(
        cardBlocks.includes(`case when coalesce(b.v ->> '${block}', 'off') = 'off' then ${blank}`),
        `${block}: закрытый блок больше не пуст`,
      );
    }
    // Все двери чтения — через ту же маску.
    assert.ok(cardBlocks.includes("else public.client_masked_for_member( p_client, (select b.blocks from public.access_client_blocks() b"));
    assert.ok(cardBlocks.includes("select public.client_masked_for_member( to_jsonb(c) || jsonb_build_object("));
    assert.ok(cardBlocks.includes("else public.client_masked_for_member(r.row_json, cb.blocks)"));
    // Помощники не зовутся снаружи.
    assert.ok(cardBlocks.includes("revoke all on function public.access_client_blocks() from public, anon, authenticated;"));
    assert.ok(cardBlocks.includes("revoke all on function public.access_block_client_ids(text, text) from public, anon;"));
  });

  test("обходные дороги закрыты: SMS, чеки, копия записи, старые записи мастера", () => {
    assert.ok(leaks.includes("'to_phone', case when p_owner then m.to_phone else '' end,"), "SMS снова отдают номер сотруднику");
    assert.ok(
      leaks.includes("if not is_owner and not (p_client_id = any(public.access_client_ids())) then return; end if;"),
      "история SMS клиента мимо набора",
    );
    assert.ok(
      leaks.includes("if not is_owner and not public.member_client_in_team(v_client, v_team) then raise exception 'sms:rights'"),
      "SMS любому клиенту компании по uuid",
    );
    assert.ok(
      leaks.includes("if not is_owner and not (v_client = any(public.access_contact_client_ids()) or v_client = any(public.access_day_contact_client_ids())) then raise exception 'sms:phone'"),
      "выбор номера SMS проверяет угаданный номер",
    );
    assert.ok(
      leaks.includes("and (v_team = any(public.access_calendars('record.client', 'read'))) is not true then raise exception 'sms:rights'"),
      "ссылка записи без «Клиент в записи»",
    );
    // Чек — без телефона клиента: снимок режет триггер, прежние строки вычищены.
    assert.ok(leaks.includes("new.client_snapshot := new.client_snapshot - 'phone';"), "в чек снова ложится телефон");
    assert.ok(
      leaks.includes("create trigger trg_receipts_client_snapshot_no_phone before insert or update on public.receipts for each row execute function public.receipts_client_snapshot_no_phone();"),
      "триггер чека снят",
    );
    assert.ok(leaks.includes("update public.receipts set client_snapshot = client_snapshot - 'phone' where client_snapshot ? 'phone';"));
    assert.ok(
      leaks.includes("and a.date between (public.tenant_business_date(public.current_tenant_id()) - 7)::text and (public.tenant_business_date(public.current_tenant_id()) + 1)::text"),
      "давний клиент команды проходит в запись мимо окна",
    );
    assert.ok(
      leaks.includes("if s.client_id is not null and not public.member_client_in_team(s.client_id, s.team_id) then raise exception 'access:client'"),
      "копия давней записи возвращает клиента в окно",
    );
    assert.ok(
      leaks.includes("or (a.status is distinct from 'cancelled' and a.date between (me.today - 7)::text and (me.today + 1)::text) as near_ok"),
      "старые записи мастера показывают давнего клиента",
    );
    assert.ok(leaks.includes("else a.team_id = any(me.ev_client_teams) end, false) and w.near_ok as see_client,"));
    assert.ok(leaks.includes("else a.team_id = any(me.ev_object_teams) end, false) and w.near_ok as see_object,"));
  });

  test("блоки карточки: правка отказывает по блоку, файлы — по «Файлам»", () => {
    for (const group of [
      "('clients.note', array['comment', 'notes'])",
      "('clients.people', array['memberships'])",
      "('clients.objects', array['locations', 'equipment', 'address', 'property_type'])",
      "('clients.labels', array['city', 'city_manual'])",
    ]) {
      assert.ok(cardBlocks.includes(group), `правка: группа ${group} выпала`);
    }
    assert.ok(cardBlocks.includes("and coalesce(card_blocks ->> g.block_key, 'off') <> 'write'"));
    assert.ok(cardBlocks.includes("and p_tag_ids is not null and coalesce(card_blocks ->> 'clients.labels', 'off') <> 'write' then"));
    for (const policy of [
      "create policy client_attachments_select_block on public.client_attachments for select to authenticated using ( tenant_id = (select public.current_tenant_id()) and client_id in (select unnest(public.access_block_client_ids('clients.files', 'read'))) );",
      "create policy client_attachments_delete_block on public.client_attachments for delete to authenticated using ( tenant_id = (select public.current_tenant_id()) and client_id in (select unnest(public.access_block_client_ids('clients.files', 'write'))) );",
    ]) {
      assert.ok(cardBlocks.includes(policy), `файлы: ${policy.slice(14, 60)}`);
    }
  });

  test("защита базы: сотруднику — список без контактов, номер — дверью по одному", () => {
    // Любой не-владелец — без контактов и денег, в каждой строке.
    assert.ok(
      oneByOne.includes(
        "as $function$ select case when public.current_user_role() = 'owner' then p_client else public.client_without_money(public.client_without_contacts(p_client)) end $function$",
      ),
      "client_seen_by_caller снова отдаёт контакты сотруднику",
    );
    assert.ok(
      oneByOne.includes(
        "return query select public.client_without_money(public.client_without_contacts( to_jsonb(c) ||",
      ),
      "list_member_clients снова отдаёт контакты сотруднику",
    );
    assert.ok(oneByOne.includes("'phone', '', 'created_at', c.created_at,"), "мастерский список снова несёт номер");
    // Дверь: клиент вне набора — «не найден»; лимит и журнал.
    assert.ok(
      oneByOne.includes(
        "if not (p_client = any(public.access_client_ids())) then raise exception 'client not found' using errcode = 'P0002';",
      ),
    );
    assert.ok(oneByOne.includes("daily_limit constant integer := 30;"));
    assert.ok(oneByOne.includes("if opened_day >= daily_limit then state := 'limit';"));
    assert.ok(oneByOne.includes("revoke all on function public.member_client_contacts(uuid) from public, anon;"));
  });

  test("защита базы: «Около записи» — только окно записи этой команды, отменённая не открывает", () => {
    assert.ok(
      oneByOne.includes(
        "and a.team_id = any(near_teams) and a.status is distinct from 'cancelled' and a.date between (today - 7)::text and (today + 1)::text",
      ),
    );
    // Условие набора целиком: «вся база», им созданные, команда клиента и её
    // записи — и больше ничего перед окном.
    assert.ok(
      oneByOne.includes(
        "where c.tenant_id = active_tenant and c.deleted_at is null and ( whole_base or c.created_by = caller or c.team_id = any(team_wide) or exists ( select 1 from public.appointments a where a.tenant_id = active_tenant and a.client_id = c.id and a.team_id = any(team_wide) ) or exists (",
      ),
      "условие набора клиентов сотрудника разошлось",
    );
    assert.ok(
      oneByOne.includes(
        "coalesce(array_agg(s.team_id) filter (where s.level in ('own', 'all')), array[]::text[]), coalesce(array_agg(s.team_id) filter (where s.level not in ('own', 'all')), array[]::text[])",
      ),
    );
    assert.ok(oneByOne.includes("update public.access_blocks set levels = array['near', 'own', 'all'],"));
    assert.ok(oneByOne.includes("update public.access_blocks set levels = array['off', 'day', 'read'],"));
  });

  test("по командам: набор, телефоны и правка — в паре с «Клиентами» той же команды", () => {
    assert.ok(perTeam.includes("return public.access_client_ids_in(public.access_calendars('clients', 'read'));"));
    assert.ok(
      perTeam.includes(
        "from unnest(public.access_calendars('clients', 'read')) as t(team_id) where t.team_id = any(public.access_calendars('clients.contacts', 'read'))",
      ),
    );
    assert.ok(
      perTeam.includes("else p_client_id = any(public.access_client_ids_in(public.access_calendars('clients', 'write')))"),
    );
    assert.ok(perTeam.includes("when (p_client ->> 'id')::uuid = any(public.access_contact_client_ids())"));
    assert.ok(perTeam.includes("revoke all on function public.access_client_ids_in(text[]) from public, anon, authenticated;"));
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
      // С 30.09 — по блоку «Люди» карточки-группы; контакты людей гасит маска.
      ["visible := public.access_client_ids();", "набор сотрудника больше не читается"],
      ["if not (p_group_id = any(visible)) then", "карточка-группа не сверяется с набором"],
      [
        "select b.blocks ->> 'clients.people' from public.access_client_blocks() b where b.client_id = p_group_id ), 'off') = 'off' then return;",
        "люди приходят без права на блок «Люди»",
      ],
      ["public.client_masked_for_member(r.row_json, cb.blocks)", "люди приходят мимо маски карточки"],
      ["and (caller_role = 'owner' or c.id = any(visible))", "люди карточки приходят мимо набора"],
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
    // С 02.10 номера, имя и мессенджеры — база: сотрудник их не меняет вовсе
    // (судят по значению — пустые номера маски поверх настоящих не лягут).
    // Связи — блок «Люди»: скрыты — в строке их нет, «Только видит» —
    // записать нельзя, «Меняет» — строка несёт настоящие.
    assert.ok(
      sql.includes(
        "from unnest(array['full_name', 'phone', 'whatsapp_phone', 'email', 'sms_name', 'telegram_username', 'instagram_username', 'phones', 'phone_e164', 'avatar_url', 'reminder_at']) as f(field) where (to_jsonb(next_row) -> f.field) is distinct from (to_jsonb(current_row) -> f.field) ) then raise exception 'only the owner changes the client base'",
      ),
      `${file}: сотрудник правит имя или номера клиента`,
    );
    assert.ok(
      sql.includes("('clients.people', array['memberships'])"),
      `${file}: связи выпали из блока «Люди» — пустой массив маски запишется поверх настоящих`,
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
      "channels.tsx",
      "maps.tsx",
      "object-types.tsx",
      "objects-settings.tsx",
      "tags.tsx",
    ]) {
      const source = read(file);
      // Подстраницы шестерёнки идут через дверь права своей строки — она
      // сама стоит на воротах источника (проверка ниже).
      assert.ok(
        source.includes("<ClientsCompanyRoute") || source.includes("<ClientSettingsRoute"),
        `${file} открывается мимо ворот источника`,
      );
    }
  });

  test("дверь права строки шестерёнки стоит на воротах источника", () => {
    const door = readFileSync(resolve(here, "ClientSettingsRoute.tsx"), "utf8");
    assert.match(door, /<ClientsCompanyRoute kind="tab">/);
    // Страница нескольких строк («Объекты», 02.10) закрыта, только если
    // скрыты все её строки.
    assert.match(door, /rows\.every\(\(key\) => levels\[key\] === "hidden"\)/, "«Скрыты» открывались бы адресом");
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
