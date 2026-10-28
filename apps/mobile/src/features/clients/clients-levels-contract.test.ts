import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { readModuleSource } from "@/lib/module-source";
import { clientsListSource, clientsListTopBarSource } from "./list/source-for-tests";

// КЛИЕНТЫ СЛУШАЮТСЯ УРОВНЕЙ — СТОРОЖ ПРАВИЛА (STORY-082).
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

// КЛИЕНТЫ ПО КОМАНДАМ: правило видимости переписано
// сознательно — «Клиенты», «Какие клиенты» и «Телефоны» стали правами команды.
// Сторож теперь держит НОВУЮ миграцию и её условия: видимость, телефоны и
// правка считаются по командам в паре с «Клиентами» этой же команды.
const PER_TEAM = "20260929160000_clients_rights_per_team.sql";
const perTeam = norm(readFileSync(join(MIGRATIONS_DIR, PER_TEAM), "utf8"));

// ЗАЩИТА БАЗЫ: списки сотрудника контактов не несут никогда,
// номер — дверью по одному клиенту; «Около записи» и «В день записи». Три
// функции переписаны сознательно — сторож держит их новые условия.
const ONE_BY_ONE = "20260930233000_clients_contacts_one_by_one.sql";
const oneByOne = norm(readFileSync(join(MIGRATIONS_DIR, ONE_BY_ONE), "utf8"));

// БЛОКИ КАРТОЧКИ (страница клиентов целиком по правам): у каждого блока карточки своё право в команде; строка сотрудника — маской
// `client_masked_for_member` по положениям `access_client_blocks`.
const CARD_BLOCKS = "20260930234000_clients_card_blocks.sql";
const cardBlocks = norm(readFileSync(join(MIGRATIONS_DIR, CARD_BLOCKS), "utf8"));

// ОБХОДНЫЕ ДОРОГИ: SMS, чеки, копия записи, старые записи
// мастера — данные клиента не уходят мимо «номер по одному» и «Около записи».
const LEAKS = "20260930235950_clients_leak_paths.sql";
// ССЫЛКА ИЗ SMS ОТМЕНЯЕТ ЗАПИСЬ: сотруднику её выдают только с
// правом «Отменять и удалять записи»; защита клиента LEAKS — на месте.
const SMS_LINKS = "20261004085941_sms_links_and_archived_calendars.sql";
const smsLinks = norm(readFileSync(join(MIGRATIONS_DIR, SMS_LINKS), "utf8"));
// Копия партнёра принимает номер с телефона (повтор без дубля) —
// с прежним сторожем клиента команды.
const COPY = "20261003191837_member_copy_idempotent.sql";
const leaks = norm(readFileSync(join(MIGRATIONS_DIR, LEAKS), "utf8"));

// «ГЛАВНОЕ» КЛИЕНТОВ: «Открывает карточку» гасит блоки
// страницы клиента, «Карточка из записи» — окно клиента записи. Обе функции
// переписаны сознательно — сторож держит их новые условия.
const OPEN_CARD = "20261001161500_clients_open_card_rights.sql";
const openCard = norm(readFileSync(join(MIGRATIONS_DIR, OPEN_CARD), "utf8"));

// «БАЗА КЛИЕНТОВ» — «СКРЫТА» ИЛИ «ТОЛЬКО ВИДИТ»: окно
// «2 недели» / «Месяц» едет с днём, блок карточки с «Меняет» правится сам,
// база (имя, номера) — только владельцу. Функции переписаны сознательно.
const BASE_READ = "20261002233700_clients_base_read_window.sql";
const baseRead = norm(readFileSync(join(MIGRATIONS_DIR, BASE_READ), "utf8"));

// «БАЗА КЛИЕНТОВ» — ТРИ СТУПЕНИ (вслед за BASE_READ):
// «Открывает карточку» и «Телефон» убраны — их даёт база; «Редактирует»
// заводит, правит и удаляет клиентов. Функции переписаны сознательно.
const THREE_LEVELS = "20261002235300_clients_base_three_levels.sql";
const threeLevels = norm(readFileSync(join(MIGRATIONS_DIR, THREE_LEVELS), "utf8"));

// БАЗА — ТОЛЬКО КЛИЕНТЫ КОМАНДЫ: «Ограничение по времени»
// (бывшее «Какие клиенты») сужает их; «История записей» и «Карточка из
// записи» убраны — их даёт база и видимая запись.
const TEAM_BASE = "20261002235800_clients_team_base_time_limit.sql";
const teamBase = norm(readFileSync(join(MIGRATIONS_DIR, TEAM_BASE), "utf8"));

// «ОГРАНИЧЕНИЯ» — ШЕСТЬ ШАГОВ: Неделя · 2 недели ·
// Месяц · 3 месяца · Полгода · Без ограничения; умолчание — «Неделя».
const LIMITS = "20261002235930_clients_limits_steps.sql";
const limits = norm(readFileSync(join(MIGRATIONS_DIR, LIMITS), "utf8"));

// «КАРТОЧКА КЛИЕНТА» ПО БЛОКАМ СТРАНИЦЫ: «Клиент», «История»,
// «SMS» — свои права; номер — по «Клиенту», SMS с карточки — по «SMS».
const CLIENT_BLOCKS = "20261003001200_clients_card_blocks_client_history_sms.sql";
const clientBlocks = norm(readFileSync(join(MIGRATIONS_DIR, CLIENT_BLOCKS), "utf8"));

// «ГЛАВНОЕ»: база — Скрыта / Видит; «Создание клиента» и
// «Меню клиента» — свои права «Не может / Может».
const CREATE_MENU = "20261003002400_clients_create_and_menu_rights.sql";
const createMenu = norm(readFileSync(join(MIGRATIONS_DIR, CREATE_MENU), "utf8"));

// «УДАЛЕНИЕ КЛИЕНТА» — СВОИМ ПРАВОМ, АРХИВА НЕТ: удаление
// одно, клиенту с историей база срок стирания не ставит.
const DELETE_RIGHT = "20261003004100_clients_delete_right_no_archive.sql";
const deleteRight = norm(readFileSync(join(MIGRATIONS_DIR, DELETE_RIGHT), "utf8"));

// ИСТОРИЮ КЛИЕНТА ЗНАЕТ ОДНА ФУНКЦИЯ: срок стирания снимается тем же
// `client_has_history`, что держит стирание, — записи, инвойсы, операции и
// долги. Правило DELETE_RIGHT то же, видов истории не меньше.
const TRASH_HISTORY = "20261027225305_trash_knows_client_history.sql";
const trashHistory = norm(readFileSync(join(MIGRATIONS_DIR, TRASH_HISTORY), "utf8"));

// ВЫДАЧА СПИСКА КЛИЕНТОВ — В ЖУРНАЛ: `list_member_clients` — обёртка с
// журналом, а тело TAG_ORDER живёт как `list_member_clients_rows` без правок.
const DISCLOSURES = "20261027225327_client_list_disclosure_journal.sql";

// МЁРТВЫЕ ВЕТКИ: «правка клиента целиком» — только владелец (у блока «Клиенты»
// нет ступени «Меняет»), ветка «номер в день записи» снята со всех дверей.
const DEAD_BRANCHES = "20261028101000_dead_rights_branches_removed.sql";

// ОДНА ПОЛИТИКА НА ДЕЙСТВИЕ: разрешающие политики таблицы слиты в `<таблица>_<действие>`
// дословным OR прежних условий — правила прав теперь читаются там.
const MERGED_POLICIES = "20261028101100_permissive_policies_merged.sql";
const disclosures = norm(readFileSync(join(MIGRATIONS_DIR, DISCLOSURES), "utf8"));

// НОМЕР — СРАЗУ: «Клиент: Видит» отдаёт контакты целиком,
// без двери и точек; «Скрыт» — без контактов.
const PHONE_OPEN = "20261003010500_clients_phone_open_with_client_block.sql";
const phoneOpen = norm(readFileSync(join(MIGRATIONS_DIR, PHONE_OPEN), "utf8"));

// СТРОКА ИСТОРИИ SMS ЗНАЕТ КЛИЕНТА И ШАБЛОН (STORY-089): «SMS
// фиксируются за клиентом», в строке — имя шаблона. Номер и деньги — по-прежнему
// только владельцу (защита `LEAKS`), это сторожит тест ниже.
const SMS_JSON = "20261003013700_sms_message_client_and_template.sql";
const smsJson = norm(readFileSync(join(MIGRATIONS_DIR, SMS_JSON), "utf8"));

// SMS ИЗ ЗАПИСИ — КЛИЕНТУ НА ЭКРАНЕ: клиент сменён и не сохранён — SMS
// ему и всё равно о записи. Охрана клиента сотрудника и номера — та же; другой
// клиент, чем у записи, — по праву «SMS: Меняет» (тело взято из базы и дополнено одной
// проверкой).
const SMS_SEND = "20261003120713_member_security_gaps.sql";
const smsSend = norm(readFileSync(join(MIGRATIONS_DIR, SMS_SEND), "utf8"));

// ЗАКРЫТЫЕ ДЫРЫ: «завёл сам» — в наборе
// своей команды; «Метка» и «Тег» — два права; «Долг и деньги» ушли в
// «Историю», у неё три положения («Скрыта» · «Своя команда» · «Все команды»).
// Тела взяты из базы и дополнены — сторож держит новые условия.
const GAPS = "20261003133700_clients_rights_gaps.sql";
const gaps = norm(readFileSync(join(MIGRATIONS_DIR, GAPS), "utf8"));

// КЛИЕНТ ЛЮБОЙ КОМАНДЫ В ЗАПИСИ ПАРТНЁРА: создание и правка записи
// пускают любого живого клиента компании (`member_client_bookable`), клиент
// своей записи виден по имени, «Номер уже есть» — дверью по полному номеру.
// Копия записи — тем же правилом; SMS остаётся на `member_client_in_team`.
const ANY_TEAM_CLIENT = "20261021113100_partner_books_any_team_client.sql";
const anyTeamClient = norm(readFileSync(join(MIGRATIONS_DIR, ANY_TEAM_CLIENT), "utf8"));

// ПОРЯДОК ТЕГОВ: запись и списки клиента переписаны по живым телам ради
// места тега в наборе; правила доступа в них те же, что в GAPS и CARD_BLOCKS
// — это держит сверка тел «только место тега» ниже.
const TAG_ORDER = "20261021113300_client_tag_order.sql";

// СКИДКА НОВОЙ ЗАПИСИ — ПО ПРАВУ «СУММА»: создание записи партнёром переписано
// по живому телу ANY_TEAM_CLIENT ради одной проверки денег; клиент любой
// команды остаётся за `member_client_bookable` — это держит сверка ниже.
const CREATE_AMOUNT = "20261027150000_member_create_amount_needs_right.sql";
const createAmount = norm(readFileSync(join(MIGRATIONS_DIR, CREATE_AMOUNT), "utf8"));

describe("сервер: клиенты по уровням", () => {
  test("правило видимости и окно живут в миграции «по командам» и не переписаны позже", () => {
    assert.equal(lastDefiner("access_client_ids"), PER_TEAM, "access_client_ids переопределён позже");
    // Мёртвую ветку «сотрудник меняет клиента» снимает DEAD_BRANCHES: пока она
    // в `parked/`, последний определитель в `migrations/` — PER_TEAM.
    assert.ok(
      [PER_TEAM, DEAD_BRANCHES].includes(lastDefiner("current_user_can_edit_client")),
      "current_user_can_edit_client переопределён позже",
    );
    for (const fn of ["access_company_level"]) {
      assert.equal(lastDefiner(fn), BASE_READ, `${fn} переопределён позже`);
    }
    assert.equal(lastDefiner("member_trash_client"), DELETE_RIGHT, "member_trash_client переопределён позже");
    assert.equal(lastDefiner("client_history_never_purges"), TRASH_HISTORY, "client_history_never_purges переопределён позже");
    assert.equal(lastDefiner("client_has_history"), TRASH_HISTORY, "client_has_history переопределён позже");
    assert.equal(lastDefiner("list_member_clients"), DISCLOSURES, "list_member_clients переопределён позже");
    assert.equal(lastDefiner("list_member_clients_rows"), "", "тело TAG_ORDER под именем list_member_clients_rows переписано");
    for (const fn of [
      "list_master_clients_safe",
      "member_appointment_copy",
      "member_appointment_update",
      "member_client_bookable",
      "member_find_client_by_phone",
    ]) {
      assert.equal(lastDefiner(fn), ANY_TEAM_CLIENT, `${fn} переопределён позже`);
    }
    assert.equal(lastDefiner("member_appointment_create"), CREATE_AMOUNT, "создание записи переопределено позже");
    for (const fn of [
      "access_client_ids_in",
      "access_client_blocks",
      "client_masked_for_member",
      "member_client_history",
    ]) {
      assert.equal(lastDefiner(fn), GAPS, `${fn} переопределён позже`);
    }
    for (const fn of [
      "access_contact_client_ids",
      "sms_for_client",
      "set_client_sms_opt_out",
    ]) {
      assert.equal(lastDefiner(fn), CLIENT_BLOCKS, `${fn} переопределён позже`);
    }
    assert.equal(lastDefiner("sms_appointment_link"), SMS_LINKS, "sms_appointment_link переопределён позже");
    for (const fn of [
      "list_master_appointments_safe",
      "receipts_client_snapshot_no_phone",
      "member_client_in_team",
    ]) {
      assert.equal(lastDefiner(fn), LEAKS, `${fn} переопределён позже`);
    }
    assert.equal(lastDefiner("sms_message_json"), SMS_JSON, "sms_message_json переопределён позже");
    assert.equal(lastDefiner("sms_send_manual"), SMS_SEND, "sms_send_manual переопределён позже");
    for (const fn of ["client_seen_by_caller", "member_client_contacts"]) {
      assert.equal(lastDefiner(fn), CARD_BLOCKS, `${fn} переопределён позже`);
    }
    for (const fn of [
      "create_client_with_tags",
      "update_client_with_tags",
      "list_client_members",
    ]) {
      assert.equal(lastDefiner(fn), TAG_ORDER, `${fn} переопределён позже`);
    }
  });

  // Порядок тегов переписал запись и списки клиента целиком. Без этой сверки
  // перенос сторожа на TAG_ORDER мог бы унести с собой любое правило доступа:
  // тела обязаны совпасть с прежними до буквы, кроме места тега в наборе.
  test("порядок тегов меняет в записи и списках клиента только место тега", () => {
    const fnBody = (file: string, fn: string) => {
      const sql = norm(readFileSync(join(MIGRATIONS_DIR, file), "utf8")).toLowerCase();
      const start = sql.search(new RegExp(String.raw`create or replace function public\.${fn}\s*\(`));
      assert.ok(start >= 0, `${file}: нет ${fn}`);
      return sql.slice(start, sql.indexOf("$function$;", start));
    };
    const placeHunks: [string, string][] = [
      [
        "insert into public.client_tag_assignments ( tenant_id, client_id, tag_id, position ) select active_tenant_id, saved_row.id, supplied.tag_id, (supplied.ord - 1)::integer from unnest(normalized_tag_ids) with ordinality supplied(tag_id, ord);",
        "insert into public.client_tag_assignments ( tenant_id, client_id, tag_id ) select active_tenant_id, saved_row.id, supplied.tag_id from unnest(normalized_tag_ids) supplied(tag_id);",
      ],
      [
        "insert into public.client_tag_assignments ( tenant_id, client_id, tag_id, position ) select active_tenant_id, p_client_id, supplied.tag_id, (supplied.ord - 1)::integer from unnest(result_tag_ids) with ordinality supplied(tag_id, ord);",
        "insert into public.client_tag_assignments ( tenant_id, client_id, tag_id ) select active_tenant_id, p_client_id, supplied.tag_id from unnest(result_tag_ids) supplied(tag_id);",
      ],
      [
        "array_agg(assignment.tag_id order by assignment.position, assignment.tag_id)",
        "array_agg(assignment.tag_id order by assignment.tag_id)",
      ],
      ["jsonb_agg(ta.tag_id order by ta.position, ta.tag_id)", "jsonb_agg(ta.tag_id order by ta.tag_id)"],
    ];
    for (const [fn, before] of [
      ["create_client_with_tags", GAPS],
      ["update_client_with_tags", GAPS],
      ["list_member_clients", CARD_BLOCKS],
      ["list_client_members", CARD_BLOCKS],
    ] as const) {
      const now = fnBody(TAG_ORDER, fn);
      assert.ok(now.includes("position"), `${fn}: место тега не учитывается`);
      const reverted = placeHunks.reduce((sql, [placed, plain]) => sql.split(placed).join(plain), now);
      assert.equal(reverted, fnBody(before, fn), `${fn}: кроме места тега изменилось что-то ещё`);
    }
  });

  test("03.10: «завёл сам» в наборе своей команды; «Метка» и «Тег» — два права; деньги — за «Историей» (GAPS)", () => {
    // Набор — прежнее правило команды и окна; «завёл сам» — только в командах набора.
    const idsBody = gaps.slice(
      gaps.indexOf("CREATE OR REPLACE FUNCTION public.access_client_ids_in"),
      gaps.indexOf("$function$;", gaps.indexOf("CREATE OR REPLACE FUNCTION public.access_client_ids_in")),
    );
    assert.ok(idsBody.includes("c.team_id in (select lv.team_id from lv where lv.level in ('own', 'all'))"));
    assert.ok(idsBody.includes("and a.date between (today - w.span)::date::text and (today + w.span)::date::text"));
    assert.ok(idsBody.includes("or (c.created_by = caller and c.team_id in (select lv.team_id from lv))"));
    // «Тег» — своё право: в блоках клиента, в маске, в правке и создании.
    assert.ok(gaps.includes("insert into public.access_blocks (key, area, scope, levels, title_ru, owner_only, live, enforced_by, position) select 'clients.tags', 'clients', 'calendar', array['off', 'read', 'write'], 'Тег',"));
    assert.ok(gaps.includes("select ma.tenant_id, ma.user_id, 'clients.tags', ma.team_id, ma.level, ma.set_by, ma.set_at from public.member_access ma where ma.block = 'clients.labels'"));
    assert.ok(gaps.includes("'clients.tags' ];"));
    assert.ok(gaps.includes("|| case when coalesce(b.v ->> 'clients.tags', 'off') = 'off' then jsonb_build_object('tag_ids', '[]'::jsonb) else '{}'::jsonb end"));
    assert.ok(gaps.includes("and coalesce(card_blocks ->> 'clients.tags', 'off') <> 'write' then denied_block := 'clients.tags';"));
    assert.ok(gaps.includes("if public.access_team_level(active_tenant_id, auth.uid(), 'clients.tags', input_row.team_id) is distinct from 'write' then"));
    // Закрытый «Клиент» прячет и фото.
    assert.ok(gaps.includes("then public.client_without_contacts(p_client) || jsonb_build_object('avatar_url', null)"));
    // «Долг и деньги» упразднено: ключа нет ни в реестре, ни в блоках клиента.
    assert.ok(gaps.includes("delete from public.member_access where block = 'clients.money';"));
    assert.ok(gaps.includes("delete from public.access_blocks where key = 'clients.money';"));
    const blocksBody = gaps.slice(
      gaps.indexOf("CREATE OR REPLACE FUNCTION public.access_client_blocks"),
      gaps.indexOf("$function$;", gaps.indexOf("CREATE OR REPLACE FUNCTION public.access_client_blocks")),
    );
    assert.ok(blocksBody.length > 0 && !blocksBody.includes("'clients.money'"), "блоки клиента снова знают «Долг и деньги»");
    assert.ok(gaps.includes("|| case when coalesce(b.v ->> 'clients.history', 'off') = 'off' then jsonb_build_object('balance', 0, 'discount', 0) else '{}'::jsonb end"));
    // «История»: три положения; кто видел — получает «Все команды».
    assert.ok(gaps.includes("update public.member_access set level = 'write' where block = 'clients.history' and level = 'read';"));
    assert.ok(gaps.includes("cb.blocks ->> 'clients.history' in ('read', 'write') as see_money"));
    assert.ok(gaps.includes("cb.blocks ->> 'clients.history' = 'write' as all_teams"));
    assert.ok(gaps.includes("select public.access_calendars('clients.history', 'read') as ids"));
    assert.ok(gaps.includes("and (h.all_teams or a.team_id = any(ht.ids))"));
  });

  test("«Источники» шестерёнки правятся своим правом, а не правом тегов (03.10)", () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();
    const touching = files.filter((name) => {
      const sql = readFileSync(join(MIGRATIONS_DIR, name), "utf8");
      return sql.includes("client_sources_write_settings") || sql.includes("policy client_sources_");
    });
    const last = touching[touching.length - 1];
    assert.equal(last, MERGED_POLICIES, "политики источников переписали позже");
    const merged = norm(readFileSync(join(MIGRATIONS_DIR, last), "utf8"));
    for (const [cmd, uses] of [["insert", 1], ["update", 2], ["delete", 1]] as const) {
      const start = merged.indexOf(`create policy client_sources_${cmd} on public.client_sources`);
      assert.ok(start >= 0, `нет client_sources_${cmd}`);
      const policy = merged.slice(start, merged.indexOf(";", start));
      assert.equal(policy.split("access_calendars('clients.settings_sources'::text, 'write'::text)").length - 1, uses, cmd);
      assert.ok(!policy.includes("settings_tags"), "источники снова правятся правом тегов");
    }
    const gear = norm(readFileSync(join(MIGRATIONS_DIR, "20261003154100_clients_settings_rights_like_gear.sql"), "utf8"));
    assert.ok(gear.includes("'clients.settings_sources', 'clients', 'calendar', array['off', 'read', 'write'], 'Источники'"));
  });

  test("база — только клиенты команды; «Ограничение по времени» едет с днём", () => {
    // Только клиент с командой из открытых — ни «завёл сам», ни записи чужой команды.
    assert.ok(teamBase.includes("c.team_id = any(team_wide)"));
    const idsBody = teamBase.slice(
      teamBase.indexOf("create or replace function public.access_client_ids_in"),
      teamBase.indexOf("$function$;", teamBase.indexOf("create or replace function public.access_client_ids_in")),
    );
    assert.ok(idsBody.length > 0 && !idsBody.includes("created_by"), "в набор снова пускает «завёл сам»");
    for (const [teams, window] of [
      ["month_teams", "a.date between (today - interval '1 month')::date::text and (today + interval '1 month')::date::text"],
      ["near_teams", "a.date between (today - 14)::text and (today + 14)::text"],
    ] as const) {
      assert.ok(
        teamBase.includes(
          `c.team_id = any(${teams}) and exists ( select 1 from public.appointments a where a.tenant_id = active_tenant and a.client_id = c.id and a.team_id = c.team_id and a.status is distinct from 'cancelled' and ${window}`,
        ),
        teams,
      );
    }
    assert.ok(teamBase.includes("update public.access_blocks set title_ru = 'Ограничение по времени' where key = 'clients.scope';"));
    // «История записей» — вместе с клиентом; «Карточка из записи» — без двери.
    assert.ok(teamBase.includes("select tm.team_id, 'clients.history'::text, 1 from teams tm"));
    assert.ok(!teamBase.includes("door_ids"));
    for (const key of ["clients.history", "clients.from_record"]) {
      assert.ok(teamBase.includes(`delete from public.member_access where block = '${key}';`), key);
      assert.ok(teamBase.includes(`delete from public.access_blocks where key = '${key}';`), key);
    }
  });

  test("«Главное»: база Скрыта / Видит, «Создание клиента» и «Меню клиента» — свои права", () => {
    assert.ok(createMenu.includes("update public.access_blocks set levels = array['off', 'read'] where key = 'clients';"));
    assert.ok(createMenu.includes("update public.member_access set level = 'read' where block = 'clients' and level = 'write';"));
    for (const key of ["clients.create", "clients.menu"]) {
      assert.ok(createMenu.includes(`('${key}', 'clients', 'calendar', array['off', 'write'],`), key);
    }
    // Создание — по своему праву, команда — из тех, где он может заводить.
    assert.ok(createMenu.includes("or cardinality(public.access_calendars('clients.create', 'write')) > 0) then"));
    assert.ok(createMenu.includes("hint = 'block:clients.create'"));
    assert.ok(!createMenu.includes("access_company('clients', 'write')"));
    // Архив, корзина, закрепление и напоминание — «Меню клиента».
    assert.ok(createMenu.includes("select b.blocks ->> 'clients.menu' into base_level"));
    assert.ok(createMenu.includes("('clients.menu', array['reminder_at', 'pinned_at'])"));
    assert.ok(createMenu.includes("revoke all on function public.member_archive_client(uuid) from public, anon;"));
  });

  test("«Удаление клиента» — своё право; «Меню клиента» — напоминание и чёрный список; архива нет", () => {
    assert.ok(deleteRight.includes("('clients.delete', 'clients', 'calendar', array['off', 'write'], 'Удаление клиента', false, true,"));
    // Удаляет партнёр по своему праву, а не по меню.
    assert.ok(deleteRight.includes("select b.blocks ->> 'clients.delete' into base_level"));
    assert.ok(deleteRight.includes("hint = 'block:clients.delete'"));
    assert.ok(!deleteRight.includes("select b.blocks ->> 'clients.menu' into base_level"));
    assert.ok(deleteRight.includes("'clients.personal', 'clients.money', 'clients.sms', 'clients.menu', 'clients.delete' ];"));
    // Чёрный список — из списка владельца в «Меню клиента».
    assert.ok(deleteRight.includes("('clients.menu', array['reminder_at', 'pinned_at', 'blacklisted'])"));
    assert.ok(deleteRight.includes("if p_patch ?| array['deleted_at', 'balance', 'discount', 'favorite_master_id'] then"));
    // Архива нет: дверь снята и нигде позже не появляется.
    assert.ok(deleteRight.includes("drop function if exists public.member_archive_client(uuid);"));
    assert.equal(lastDefiner("member_archive_client"), CREATE_MENU, "дверь архива вернулась");
    // Клиенту с историей срок стирания не ставится — правилом базы.
    assert.ok(
      deleteRight.includes(
        "if new.purge_at is not null and ( exists (select 1 from public.appointments a where a.client_id = new.id) or exists (select 1 from public.invoices i where i.client_id = new.id) or exists (select 1 from public.finance_transactions f where f.client_id = new.id) ) then new.purge_at := null;",
      ),
    );
    assert.ok(deleteRight.includes("before insert or update of purge_at on public.clients for each row execute function public.client_history_never_purges();"));
    assert.ok(deleteRight.includes("revoke all on function public.client_history_never_purges() from public, anon, authenticated;"));
    // Живое тело — TRASH_HISTORY: то же правило через `client_has_history`.
    assert.ok(
      trashHistory.includes(
        "if new.purge_at is not null and public.client_has_history(new.id, false) then new.purge_at := null;",
      ),
      "клиенту с историей снова ставится срок стирания",
    );
    for (const kind of [
      "exists (select 1 from public.appointments a where a.client_id = p_client)",
      "or exists (select 1 from public.invoices i where i.client_id = p_client)",
      "or exists (select 1 from public.finance_transactions f where f.client_id = p_client)",
      "or exists (select 1 from public.debts d where d.client_id = p_client)",
    ]) {
      assert.ok(trashHistory.includes(kind), `история клиента потеряла: ${kind}`);
    }
  });

  test("выдача списка клиентов сотруднику пишется в журнал, тело списка — прежнее (DISCLOSURES)", () => {
    assert.ok(disclosures.includes("alter function public.list_member_clients(uuid) rename to list_member_clients_rows;"));
    assert.ok(disclosures.includes("revoke all on function public.list_member_clients_rows(uuid) from public, anon, authenticated;"));
    assert.ok(disclosures.includes("return query select x from public.list_member_clients_rows(p_client_id) x;"));
    assert.ok(
      disclosures.includes("insert into public.client_list_disclosures (tenant_id, user_id, clients_count)"),
      "выдача списка не пишется в журнал",
    );
  });

  test("номер — сразу по блоку «Клиент», без двери и точек (03.10)", () => {
    // Маска: «Скрыт» — без контактов, «Видит» — строка целиком.
    assert.ok(
      phoneOpen.includes(
        "select case when coalesce(b.v ->> 'clients.client', 'off') = 'off' then public.client_without_contacts(p_client) else p_client end",
      ),
    );
    // Связи — только своим блоком, даже когда контакты открыты.
    assert.ok(
      phoneOpen.includes(
        "|| case when coalesce(b.v ->> 'clients.people', 'off') = 'off' then jsonb_build_object('memberships', '[]'::jsonb)",
      ),
    );
    // Выбор клиента мастера — номер у тех же клиентов.
    assert.ok(phoneOpen.includes("'phone', case when c.id = any(cs.open_ids) then c.phone else '' end,"));
    // Последнее определение двери клиентов записи держит то же правило номера.
    assert.ok(anyTeamClient.includes("'phone', case when c.id = any(cs.open_ids) then c.phone else '' end,"));
  });

  test("партнёр записывает клиента любой команды компании, но базу и номер это не открывает", () => {
    // Годится любой живой клиент активной компании — и только он.
    assert.ok(
      anyTeamClient.includes(
        "select p_client is not null and exists ( select 1 from public.clients c where c.id = p_client and c.tenant_id = public.current_tenant_id() and c.deleted_at is null );",
      ),
    );
    assert.ok(anyTeamClient.includes("revoke all on function public.member_client_bookable(uuid) from public, anon, authenticated;"));
    // Создание, правка и копия спрашивают его; прежняя проверка команды ушла.
    for (const [fn, check] of [
      ["member_appointment_create", "if not public.member_client_bookable((v_rest ->> 'client_id')::uuid) then raise exception 'access:client'"],
      ["member_appointment_update", "if not public.member_client_bookable((p_patch ->> 'client_id')::uuid) then raise exception 'access:client'"],
      ["member_appointment_copy", "if s.client_id is not null and not public.member_client_bookable(s.client_id) then raise exception 'access:client'"],
    ] as const) {
      const start = anyTeamClient.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
      const body = anyTeamClient.slice(start, anyTeamClient.indexOf("$function$;", start));
      assert.ok(start >= 0 && body.includes(check), `${fn}: клиент не по member_client_bookable`);
      assert.ok(!body.includes("member_client_in_team"), `${fn}: снова клиент только своей команды`);
    }
    // Последнее создание записи держит то же правило клиента и вдобавок
    // спрашивает «Сумму» у скидки и своей цены.
    const createStart = createAmount.search(/create or replace function public\.member_appointment_create\(/i);
    const createBody = createAmount.slice(createStart, createAmount.indexOf("$function$;", createStart));
    assert.ok(
      createBody.includes("if not public.member_client_bookable((v_rest ->> 'client_id')::uuid) then raise exception 'access:client'"),
      "member_appointment_create: клиент не по member_client_bookable",
    );
    assert.ok(!createBody.includes("member_client_in_team"), "member_appointment_create: снова клиент только своей команды");
    assert.ok(
      createBody.includes("if v_money_set and not public.member_can('record.amount', 'write', v_team) then raise exception 'access:block:record.amount'"),
      "member_appointment_create: скидка без права «Сумма»",
    );
    // Право на запись не ослабло: «Новые записи» в команде записи.
    assert.ok(anyTeamClient.includes("if v_kind = 'work' and not public.member_can('calendar.create', 'write', v_team) then raise exception 'access:block:calendar.create'"));
    // Имя клиента своей записи — в окне «Ограничения»; номер — прежним правилом.
    assert.ok(
      anyTeamClient.includes(
        "and a.team_id = any(ct.ids) and a.created_by = auth.uid() and a.date >= coalesce(cs.window_starts ->> a.team_id, '')",
      ),
    );
    // «Номер уже есть» — только при «Новых записях» в команде, только полный номер.
    assert.ok(anyTeamClient.includes("if public.member_can('calendar.create', 'write', p_team) is not true then raise exception 'access:block:calendar.create'"));
    assert.ok(anyTeamClient.includes("if p_phone_e164 is null or p_phone_e164 !~ '^\\+[1-9][0-9]{6,14}$' then return null;"));
    assert.ok(anyTeamClient.includes("'phone', case when is_open then hit.phone else '' end,"));
    assert.ok(anyTeamClient.includes("revoke all on function public.member_find_client_by_phone(text, text) from public, anon;"));
    // Копия: по-прежнему «Перенос записей» и окно «Ограничения» — давнюю
    // запись с давним клиентом партнёр не копирует.
    const copyStart = anyTeamClient.indexOf("CREATE OR REPLACE FUNCTION public.member_appointment_copy(");
    const copyBody = anyTeamClient.slice(copyStart, anyTeamClient.indexOf("$function$;", copyStart));
    assert.ok(copyBody.includes("if public.member_record_hidden(s.kind, s.team_id, s.date) then raise exception"));
    assert.ok(copyBody.includes("if not public.member_can('calendar.move', 'write', s.team_id) then raise exception 'access:block:calendar.move'"));
    assert.ok(copyBody.includes("p_id uuid DEFAULT NULL::uuid"), "у копии пропало умолчание p_id");
    // SMS из записи по-прежнему проверяет клиента команды.
    assert.equal(lastDefiner("sms_send_manual"), SMS_SEND, "sms_send_manual переопределён позже");
    assert.ok(smsSend.includes("member_client_in_team(v_client, v_team)"));
  });

  test("«Клиент», «История», «SMS» — свои права; номер и SMS с карточки — по ним", () => {
    for (const key of ["clients.client", "clients.history", "clients.sms"]) {
      assert.ok(clientBlocks.includes(`('${key}', 'clients', 'calendar', array[`), key);
    }
    // Тем, кто уже работает, — то, что они видели.
    assert.ok(
      clientBlocks.includes(
        "case when b.block = 'clients.client' and ma.level = 'write' then 'write' else 'read' end from public.member_access ma cross join (values ('clients.client'), ('clients.history'), ('clients.sms')) as b(block) where ma.block = 'clients'",
      ),
    );
    assert.ok(clientBlocks.includes("'clients.client', 'clients.note', 'clients.people', 'clients.history',"));
    assert.ok(!clientBlocks.includes("'clients.history'::text, 1"), "история снова гарантирована мимо права");
    assert.ok(clientBlocks.includes("then public.access_block_client_ids('clients.client', 'read')"));
    assert.ok(clientBlocks.includes("hint = 'block:clients.client'"));
    assert.ok(clientBlocks.includes("('clients.sms', array['sms_name'])"));
    assert.ok(clientBlocks.includes("if not is_owner and not (p_client_id = any(public.access_block_client_ids('clients.sms', 'read'))) then return;"));
    assert.ok(
      clientBlocks.includes(
        "if not is_owner and p_appointment_id is null and not (v_client = any(public.access_block_client_ids('clients.sms', 'write'))) then raise exception 'sms:rights'",
      ),
    );
    assert.ok(clientBlocks.includes("or p_client_id = any(public.access_block_client_ids('clients.sms', 'write'))"));
  });

  test("«Ограничения» — шесть шагов, окно по записи своей команды, умолчание «Неделя»", () => {
    assert.ok(
      limits.includes(
        "update public.access_blocks set levels = array['week', 'near', 'month', 'quarter', 'half', 'own'], title_ru = 'Ограничения' where key = 'clients.scope';",
      ),
    );
    assert.ok(limits.includes("coalesce(public.access_team_level(active_tenant, caller, 'clients.scope', t.team_id), 'week') as level"));
    assert.ok(
      limits.includes(
        "case lv.level when 'near' then interval '14 days' when 'month' then interval '1 month' when 'quarter' then interval '3 months' when 'half' then interval '6 months' else interval '7 days' end as span",
      ),
    );
    // Только клиент своей команды и запись этой же команды; отменённая окна не открывает.
    assert.ok(limits.includes("c.team_id in (select lv.team_id from lv where lv.level in ('own', 'all'))"));
    assert.ok(limits.includes("and a.team_id = w.team_id where w.team_id = c.team_id and a.status is distinct from 'cancelled'"));
    assert.ok(limits.includes("and a.date between (today - w.span)::date::text and (today + w.span)::date::text"));
    const idsBody = limits.slice(limits.indexOf("create or replace function public.access_client_ids_in"));
    assert.ok(!idsBody.includes("created_by"), "в набор снова пускает «завёл сам»");
  });

  test("окно «Какие клиенты» едет с днём: 2 недели, месяц, своей команды (BASE_READ)", () => {
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
  });

  test("база — «Скрыта · Только видит · Редактирует»; карточку и номер даёт база; блок правится своим правом", () => {
    assert.ok(threeLevels.includes("update public.access_blocks set levels = array['off', 'read', 'write'] where key = 'clients';"));
    // «Открывает карточку» и «Телефон» убраны вместе со строками партнёров.
    for (const key of ["clients.open", "clients.contacts"]) {
      assert.ok(threeLevels.includes(`delete from public.member_access where block = '${key}';`), key);
      assert.ok(threeLevels.includes(`delete from public.access_blocks where key = '${key}';`), key);
    }
    // Номер — у каждого видимого клиента.
    assert.ok(
      threeLevels.includes(
        "when public.current_user_role() is distinct from 'owner' then public.access_client_ids_in(public.access_calendars('clients', 'read'))",
      ),
    );
    // Блоки страницы не гаснут без «Открывает карточку»; «Меняет» блока — своим правом.
    assert.ok(!threeLevels.includes("open_level"));
    assert.ok(!teamBase.includes("open_level"));
    assert.ok(teamBase.includes("when l.level = 'write' then 2 when l.level in ('read', 'write') then 1"));
    assert.ok(threeLevels.includes("when l.level = 'write' then 2 when l.level in ('read', 'write') then 1"));
    assert.ok(!threeLevels.includes("when l.level = 'write' and tm.card_level = 'write' then 2"));
    // Правка — только видимого клиента, вход по «Видит»; база — по «Редактирует».
    assert.ok(threeLevels.includes("or not (active_role = 'owner' or public.access_company('clients', 'read')) then"));
    assert.ok(
      threeLevels.includes(
        "and (p_client_id = any(public.access_client_ids_in(public.access_calendars('clients', 'read')))) is not true then raise exception 'client not found'",
      ),
    );
    assert.ok(threeLevels.includes("if coalesce(card_blocks ->> 'clients', 'off') <> 'write' and exists ("));
    // Удаляет партнёр с «Редактирует» своей дверью; незашедшему она закрыта.
    assert.ok(threeLevels.includes("if base_level is distinct from 'write' then"));
    assert.ok(threeLevels.includes("revoke all on function public.member_trash_client(uuid) from public, anon;"));
  });

  test("«Карточка из записи» — условия на сервере", () => {
    // Клиент записи — только из команды, где открыт переход из записи, и
    // «Около записи» осталось на месте.
    assert.ok(openCard.includes("and a.team_id = any(ct.ids) and a.team_id = any(ct.door_ids)"));
    assert.ok(openCard.includes("and a.date between (cs.today - 7)::text and (cs.today + 1)::text"));
    // У тех, кто уже работает, ничего не пропадает.
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
    // Строку истории переписала миграция «клиент и шаблон» — маска та же.
    assert.ok(smsJson.includes("'to_phone', case when p_owner then m.to_phone else '' end,"), "SMS снова отдают номер сотруднику");
    assert.ok(smsJson.includes("'cost_cents', case when p_owner then m.cost_cents else 0 end,"), "SMS снова отдают цену сотруднику");
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
    // Отправку переписала миграция «клиент на экране» — охрана та же.
    for (const guard of [
      "if not is_owner and not public.member_client_in_team(v_client, v_team) then raise exception 'sms:rights'",
      "if not is_owner and not (v_client = any(public.access_contact_client_ids()) or v_client = any(public.access_day_contact_client_ids())) then raise exception 'sms:phone'",
      "if not public.sms_client_owns_phone(v_client, p_phone) then raise exception 'sms:phone'",
      "if not is_owner and p_appointment_id is null and not (v_client = any(public.access_block_client_ids('clients.sms', 'write'))) then raise exception 'sms:rights'",
      "where cl.id = v_client and cl.tenant_id = v_tenant;",
      // Другой клиент, чем у записи, — по праву «SMS: Меняет».
      "if v_client is distinct from a.client_id and not (v_client = any(public.access_block_client_ids('clients.sms', 'write'))) then raise exception 'sms:rights'",
    ]) {
      assert.ok(smsSend.includes(guard), `отправка SMS потеряла охрану: ${guard}`);
    }
    assert.ok(
      leaks.includes("and (v_team = any(public.access_calendars('record.client', 'read'))) is not true then raise exception 'sms:rights'"),
      "ссылка записи без «Клиент в записи»",
    );
    // Последнее определение ссылки держит и защиту клиента, и право отмены.
    assert.ok(
      smsLinks.includes("and (v_team = any(public.access_calendars('record.client', 'read'))) is not true then raise exception 'sms:rights'"),
      "ссылка записи без «Клиент в записи»",
    );
    assert.ok(
      smsLinks.includes("and public.member_can('calendar.cancel', 'write', v_team) is not true then raise exception 'sms:rights'"),
      "ссылку записи выдают без права отмены",
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
    // Копию определила миграция без дублей, последней — «клиент любой
    // команды»: клиент копии — по `member_client_bookable`, а давнюю запись
    // не копирует окно «Ограничения» (тест «партнёр записывает клиента…»).
    const copy = norm(readFileSync(join(MIGRATIONS_DIR, COPY), "utf8"));
    assert.equal(lastDefiner("member_appointment_copy"), ANY_TEAM_CLIENT, "копия переопределена позже");
    assert.ok(
      copy.includes("revoke all on function public.member_appointment_copy(uuid, text, text, text, uuid) from public, anon;"),
      "новая сигнатура копии осталась исполнимой для anon",
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
  // законно переписала оба помощника: номера людей клиента и
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

  // STORY-085: человек клиента — отдельный клиент, и его контакты
  // прячет его собственная строка тем же помощником. STORY-086
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
      // По блоку «Люди» карточки-группы; контакты людей гасит маска.
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
    // Номера, имя и мессенджеры — блок «Клиент»: правит их только
    // «Меняет» (судят по значению). Номер приходит целиком тому, кто
    // блок видит, поэтому «сначала открой дверью» снято — пустых номеров
    // маски поверх настоящих больше нет. Связи — блок «Люди»: скрыты — в
    // строке их нет, «Только видит» — записать нельзя, «Меняет» — строка
    // несёт настоящие.
    assert.ok(
      sql.includes(
        "where (to_jsonb(next_row) -> f.field) is distinct from (to_jsonb(current_row) -> f.field) ) then raise exception 'this block of the client card is closed for this employee' using errcode = '42501', hint = 'block:clients.client';",
      ),
      `${file}: партнёр без «Клиент: Меняет» правит имя или номера клиента`,
    );
    assert.ok(!sql.includes("open the contacts before changing them"), `${file}: вернулась дверь номера в правке`);
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
      "trash.tsx",
      "tags.tsx",
      "settings.tsx",
      "card-fields.tsx",
      "visits.tsx",
      "attachments.tsx",
      "sms.tsx",
      "channels.tsx",
      "maps.tsx",
      "object-types.tsx",
      "sources.tsx",
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
    // Страница нескольких строк («Объекты») закрыта, только если
    // скрыты все её строки.
    assert.match(door, /rows\.every\(\(key\) => levels\[key\] === "hidden"\)/, "«Скрыты» открывались бы адресом");
  });

  test("общий адрес из записи держит компанию календаря", () => {
    const door = readFileSync(resolve(here, "../../../app/(shared)/client.tsx"), "utf8");
    assert.match(door, /<ClientsCompanyRoute kind="card" forceActive>/);
  });

  // «Связь» и «Карты» из записи не должны стоять за ролью календаря: партнёр
  // с открытой строкой упирался бы в стену, а шестерёнка листа ему пряталась.
  test("«Связь» и «Карты» из записи — те же ворота строки, что во вкладке", () => {
    for (const page of ["channels", "maps"]) {
      const door = readFileSync(resolve(here, `../../../app/(shared)/${page}.tsx`), "utf8");
      assert.ok(
        door.includes(`export { default } from "../(dashboard)/clients/${page}";`),
        `(shared)/${page}.tsx открывает не экран вкладки с его воротами`,
      );
      assert.ok(!door.includes("RoleCapabilityBoundary"), `(shared)/${page}.tsx: вернулась граница роли`);
    }
  });

  // ВИЗУАЛ ВКЛАДКИ НЕ ЗАВИСИТ ОТ ТОГО, ЧТО ОТКРЫТО В КАЛЕНДАРЕ: шестерёнка и
  // аналитика не гаснут, пока своя компания не станет активной.
  test("шестерёнка и аналитика не смотрят на активную компанию", () => {
    // Список — маршрут + папка `list/`; шапка с лентой команд — `ListTopBar.tsx`.
    const list = clientsListSource();
    const top = clientsListTopBarSource();
    // Срез строго по разметке шапки: от шестерёнки до ленты команд под ней.
    // Якорь — сама шестерёнка; не найден — тест падает, а не проверяет весь
    // файл. `minHeight: 48` якорем быть не может: та же высота у полосы
    // выбора над шапкой, и срез молча начался бы с неё.
    const start = top.indexOf('id="clients.gear"');
    const end = top.indexOf("<ScopeChips");
    assert.ok(start > 0 && end > start, "границы шапки списка не найдены");
    const header = top.slice(start, end);
    assert.ok(header.includes("Настройки клиентов"), "шапка списка не найдена");
    assert.ok(
      !/isActive/.test(header),
      "двери шапки снова закрыты тем, какая компания открыта в календаре",
    );
    // Шестерёнка — в шапке; «Аналитика» живёт в шторке фильтров (кнопка
    // внизу шторки) — тем же правилом источника.
    assert.ok(
      header.includes("clientsSettingsHref()") && list.includes("router.push(clientsInsightsHref(scope))"),
      "шапка ведёт мимо правила источников",
    );
    assert.ok(
      !list.includes("useCurrentRole"),
      "список снова спрашивает роль в активной компании вместо источника",
    );
    // ДВЕРИ ШАПКИ НЕ ЗАВИСЯТ И ОТ ИСТОЧНИКА (визуал страницы сохраняется
    // целиком): шестерёнка и аналитика стоят всегда,
    // а что за ними — решает уже сама страница.
    assert.ok(
      !/\{caps\.manage[^}]*\?\s*\(?\s*<Pressable/.test(header),
      "двери шапки снова гаснут по правам",
    );
    // Футер на месте и гаснет, а не исчезает — по ВЫБРАННОЙ команде
    // (запрещено — гасим): своя — `caps.create`,
    // команда партнёра — её «Создание клиента».
    assert.ok(
      /disabled=\{!createHere\}/.test(list),
      "кнопка «Создать клиента» снова исчезает вместо того, чтобы гаснуть",
    );
    assert.ok(
      /chipGuestAccess\?\.calendars\[teamChoice\]\?\.\["clients\.create"\] === "write"/.test(list) &&
        /: caps\.create;/.test(list),
      "кнопка «Создать клиента» снова не смотрит на выбранную команду",
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
    const queries = readModuleSource(join(here, "queries.ts"));
    for (const hook of ["useClients", "useClient", "useClientTags", "useCreateClient", "useArchiveClients"]) {
      const at = queries.indexOf(`export function ${hook}(`);
      assert.ok(at >= 0, `нет хука ${hook}`);
      const body = queries.slice(at, at + 900);
      assert.ok(body.includes("useQueryScope()"), `${hook} не спрашивает источник`);
      assert.ok(!body.includes("useTenantId()"), `${hook} снова берёт активную компанию`);
    }
  });
});
