-- ДОЧИСТКА «ЛИЧНОЕ И КОМПАНИИ» (откат владельца 12.10, 20261012041650).
--
-- Откат оставил функции компаний и колонки `tenants.kind/personal_of/
-- created_by`, пока телефоны не получат обновление без компаний: их звали
-- обновления 63d17581 / 609ccd2b / dc918d62. Обновления без компаний
-- (94fb10f7 на 1.0.3, 26567f7b на 1.0.2) вышли 12.10; в логах API за сутки
-- до этой миграции ни одного вызова create_company, list_my_accounts,
-- leave_company, transfer_company_ownership, companies_blocking_account_delete.
--
-- Остаются `ensure_personal_space` и `personal_calendar_name`: обычная
-- регистрация (handle_new_user) заводит через них аккаунт с календарём
-- «Личный». Ниже они и `start_trial` перестают трогать снимаемые колонки.

-- ─── 1. Живые функции — без kind/personal_of/created_by ──────────────────

/** Аккаунт нового человека: аккаунт с его именем, он владелец, настройки
 *  календаря и календарь «Личный». Уже владеет аккаунтом — вернуть его.
 *  Только для функций базы (зовёт handle_new_user). */
create or replace function public.ensure_personal_space(p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_meta jsonb;
  v_email text;
  v_name text;
begin
  select tm.tenant_id into v_tenant
    from public.tenant_members tm
   where tm.user_id = p_user and tm.role = 'owner'
   order by tm.joined_at, tm.tenant_id
   limit 1;
  if v_tenant is not null then
    return v_tenant;
  end if;

  select coalesce(u.raw_user_meta_data, '{}'::jsonb), u.email
    into v_meta, v_email
    from auth.users u
   where u.id = p_user;
  if not found then
    raise exception 'нет такого человека' using errcode = '22023';
  end if;

  v_name := coalesce(
    nullif(btrim(v_meta ->> 'full_name'), ''),
    nullif(btrim(v_meta ->> 'business_name'), ''),
    nullif(split_part(coalesce(v_email, ''), '@', 1), ''),
    'Личное'
  );

  insert into public.tenants (name, vertical, onboarded_at)
  values (v_name, 'other', now())
  returning id into v_tenant;

  insert into public.tenant_members (tenant_id, user_id, role, joined_at)
  values (v_tenant, p_user, 'owner', now());

  insert into public.calendar_settings (tenant_id)
  values (v_tenant)
  on conflict (tenant_id) do nothing;

  insert into public.teams (id, tenant_id, name, payout_percentage)
  values (
    'team-' || replace(gen_random_uuid()::text, '-', ''),
    v_tenant,
    public.personal_calendar_name(v_meta ->> 'locale'),
    30
  );

  return v_tenant;
end;
$$;

revoke all on function public.ensure_personal_space(uuid) from public, anon, authenticated;

do $$
declare
  v_def text;
  v_old text;
begin
  -- Пробный — «полный доступ» в любом аккаунте; вид аккаунта больше не читается.
  select pg_get_functiondef('public.start_trial(text)'::regprocedure) into v_def;
  v_old := $q$  v_kind text;
$q$;
  if position(v_old in v_def) = 0 then
    raise exception 'start_trial: якорь v_kind не найден';
  end if;
  v_def := replace(v_def, v_old, '');
  v_old := $q$  select t.kind, t.trial_started_at into v_kind, v_started$q$;
  if position(v_old in v_def) = 0 then
    raise exception 'start_trial: якорь select не найден';
  end if;
  v_def := replace(v_def, v_old, $q$  select t.trial_started_at into v_started$q$);
  v_old := $q$  -- Личное — только Соло, компания — не ниже Про. Приложения из магазина
  -- (1.0.2, 1.0.3) предлагают пробный «Про» и в Личном: не отказ, а Соло.
  p_tier := 'max';$q$;
  if position(v_old in v_def) = 0 then
    raise exception 'start_trial: якорь тарифа не найден';
  end if;
  v_def := replace(v_def, v_old, $q$  -- Пробный — всегда полный доступ, какой бы тариф ни прислала сборка.
  p_tier := 'max';$q$);
  execute v_def;

  -- Устаревший комментарий о Личном у пришедшего по приглашению.
  select pg_get_functiondef('public.handle_new_user()'::regprocedure) into v_def;
  v_old := $q$    -- ЛИЧНОЕ — У КАЖДОГО (11.10), и у пришедшего по приглашению: телефон
    -- открывает компанию, Личное стоит в ленте первым.
$q$;
  if position(v_old in v_def) = 0 then
    raise exception 'handle_new_user: якорь не найден';
  end if;
  v_def := replace(v_def, v_old, '');
  v_old := $q$  -- ОБЫЧНАЯ РЕГИСТРАЦИЯ — ЛИЧНОЕ (11.10): аккаунт с именем человека и
  -- календарь «Личный». Компанию человек заводит сам, когда понадобится.$q$;
  if position(v_old in v_def) = 0 then
    raise exception 'handle_new_user: якорь обычной регистрации не найден';
  end if;
  v_def := replace(v_def, v_old, $q$  -- ОБЫЧНАЯ РЕГИСТРАЦИЯ: аккаунт с именем человека и календарь «Личный».$q$);
  execute v_def;
end;
$$;

-- ─── 2. Функции компаний ─────────────────────────────────────────────────

drop function if exists public.create_company(text);
drop function if exists public.transfer_company_ownership(uuid, uuid);
drop function if exists public.leave_company(uuid);
drop function if exists public.list_my_accounts();
drop function if exists public.companies_blocking_account_delete(uuid);
drop function if exists public.grant_full_company_access(uuid, uuid, uuid);

-- ─── 3. Колонки вида аккаунта ────────────────────────────────────────────

drop trigger if exists tenants_guard_kind on public.tenants;
drop function if exists public.tenants_guard_kind();

drop index if exists public.tenants_personal_of_key;
alter table public.tenants
  drop constraint if exists tenants_personal_of_matches_kind,
  drop constraint if exists tenants_kind_check;

alter table public.tenants
  drop column if exists kind,
  drop column if exists personal_of,
  drop column if exists created_by;
