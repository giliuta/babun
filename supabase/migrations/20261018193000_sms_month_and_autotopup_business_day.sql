-- Месяц SMS и дневной предел автопополнения — по часам компании, а не UTC.
--
-- `sms_account()` считал «отправлено в этом месяце» от `date_trunc('month',
-- now())` — это полночь 1-го по UTC. Для компании в Europe/Nicosia SMS,
-- ушедшие 1-го числа с 00:00 до 02:59 местного, попадали в прошлый месяц.
-- Теперь начало месяца — полночь 1-го в зоне компании
-- (`calendar_settings.timezone`, по умолчанию Europe/Nicosia — так же, как в
-- `tenant_business_date`).
--
-- Автопополнение ограничено тремя попытками в день (`sms_autotopup.day` +
-- `day_count`), но «день» был `current_date` сервера, то есть UTC: счётчик
-- обнулялся в 02:00/03:00 местного, посреди рабочей ночи. Теперь день —
-- `tenant_business_date(tenant)`. Эта функция отдаёт NULL вызывающему из
-- чужой компании; автопополнение зовут крон и сервисные функции, но на
-- случай чужого вызова остаётся запасной `current_date`, чтобы предел не
-- выключился сравнением с NULL.
--
-- `sms_account` и `sms_autotopup_claim` правятся заменой по якорям: чужие
-- правки в других местах тел переживают эту миграцию. Маленькая
-- `sms_autotopup_is_due` пересоздаётся целиком (права сохраняются).

set local lock_timeout = '5s';

-- 1. sms_account(): начало месяца в зоне компании.
do $patch$
declare
  fn_def text := pg_get_functiondef('public.sms_account()'::regprocedure);
  decl_anchor constant text :=
    $a$  month_start timestamptz := date_trunc('month', now());$a$;
  decl_replacement constant text := $a$  month_start timestamptz;
  tenant_timezone text;$a$;
  body_anchor constant text :=
    $a$  select * into cfg from public.tenant_sms_config where tenant_id = v_tenant;$a$;
  body_replacement constant text := $a$  -- Месяц — от полуночи 1-го числа в зоне компании, а не по UTC.
  select cs.timezone into tenant_timezone
    from public.calendar_settings cs
   where cs.tenant_id = v_tenant;
  tenant_timezone := coalesce(nullif(btrim(tenant_timezone), ''), 'Europe/Nicosia');
  begin
    month_start := date_trunc('month', now(), tenant_timezone);
  exception when invalid_parameter_value then
    month_start := date_trunc('month', now(), 'Europe/Nicosia');
  end;
  select * into cfg from public.tenant_sms_config where tenant_id = v_tenant;$a$;
begin
  if position('date_trunc(''month'', now(), tenant_timezone)' in fn_def) > 0 then
    raise notice 'sms_account уже считает месяц в зоне компании';
  else
    if (length(fn_def) - length(replace(fn_def, decl_anchor, ''))) / length(decl_anchor) <> 1 then
      raise exception 'sms_account: якорь объявления month_start не найден ровно один раз';
    end if;
    if (length(fn_def) - length(replace(fn_def, body_anchor, ''))) / length(body_anchor) <> 1 then
      raise exception 'sms_account: якорь чтения tenant_sms_config не найден ровно один раз';
    end if;
    fn_def := replace(fn_def, decl_anchor, decl_replacement);
    fn_def := replace(fn_def, body_anchor, body_replacement);
    execute fn_def;
  end if;
end
$patch$;

-- 2. sms_autotopup_is_due(): «три в день» — по рабочему дню компании.
create or replace function public.sms_autotopup_is_due(
  a public.sms_autotopup,
  p_balance integer,
  p_frozen boolean
)
returns boolean
language sql
stable
set search_path to 'public'
as $function$
  select a.enabled
     and a.payment_method is not null
     and a.stripe_customer is not null
     and not coalesce(p_frozen, false)
     and coalesce(p_balance, 0) < a.threshold_cents
     and coalesce(p_balance, 0) >= 0
     and (a.pending_since is null or a.pending_since < now() - interval '30 minutes')
     and (a.last_success_at is null or a.last_success_at < now() - interval '15 minutes')
     -- День предела — рабочий день компании (не UTC); запасной current_date
     -- только если зону прочитать не дали.
     and (a.day is distinct from coalesce(public.tenant_business_date(a.tenant_id), current_date)
          or a.day_count < 3);
$function$;

-- 3. sms_autotopup_claim(): счётчик дня пишется тем же рабочим днём.
do $patch$
declare
  fn_def text := pg_get_functiondef('public.sms_autotopup_claim()'::regprocedure);
  decl_anchor constant text := $a$  frozen boolean;
begin$a$;
  decl_replacement constant text := $a$  frozen boolean;
  -- Рабочий день компании: тот же, что проверяет sms_autotopup_is_due.
  business_day date;
begin$a$;
  day_anchor constant text := $a$      a.day_count := case when a.day is distinct from current_date then 1 else a.day_count + 1 end;
      a.day := current_date;$a$;
  day_replacement constant text := $a$      business_day := coalesce(public.tenant_business_date(a.tenant_id), current_date);
      a.day_count := case when a.day is distinct from business_day then 1 else a.day_count + 1 end;
      a.day := business_day;$a$;
begin
  if position('a.day := business_day;' in fn_def) > 0 then
    raise notice 'sms_autotopup_claim уже считает день по компании';
  else
    if (length(fn_def) - length(replace(fn_def, decl_anchor, ''))) / length(decl_anchor) <> 1 then
      raise exception 'sms_autotopup_claim: якорь объявлений не найден ровно один раз';
    end if;
    if (length(fn_def) - length(replace(fn_def, day_anchor, ''))) / length(day_anchor) <> 1 then
      raise exception 'sms_autotopup_claim: якорь счётчика дня не найден ровно один раз';
    end if;
    fn_def := replace(fn_def, decl_anchor, decl_replacement);
    fn_def := replace(fn_def, day_anchor, day_replacement);
    execute fn_def;
  end if;
end
$patch$;

do $guard$
declare
  account_def text := pg_get_functiondef('public.sms_account()'::regprocedure);
  due_def text := pg_get_functiondef(
    'public.sms_autotopup_is_due(public.sms_autotopup, integer, boolean)'::regprocedure
  );
  claim_def text := pg_get_functiondef('public.sms_autotopup_claim()'::regprocedure);
begin
  if position('date_trunc(''month'', now(), tenant_timezone)' in account_def) = 0
     or position('date_trunc(''month'', now());' in account_def) > 0 then
    raise exception 'sms_account всё ещё считает месяц по UTC';
  end if;
  if position('tenant_business_date(a.tenant_id)' in due_def) = 0 then
    raise exception 'sms_autotopup_is_due всё ещё считает день по UTC';
  end if;
  if position('a.day := business_day;' in claim_def) = 0
     or position('a.day := current_date;' in claim_def) > 0 then
    raise exception 'sms_autotopup_claim всё ещё считает день по UTC';
  end if;
  if has_function_privilege('anon', 'public.sms_autotopup_is_due(public.sms_autotopup, integer, boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.sms_autotopup_is_due(public.sms_autotopup, integer, boolean)', 'execute') then
    raise exception 'sms_autotopup_is_due стала доступна клиентам';
  end if;
end
$guard$;
