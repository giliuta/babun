-- Replace one team's manual day-finance rows in one transaction. The previous
-- The 14-digit prefix is a unique Supabase CLI migration version.
-- mobile repository issued DELETE and INSERT as separate PostgREST requests,
-- so an insert/connection failure permanently lost the prior list.

create or replace function public.replace_day_extras(
  p_team_id text,
  p_date text,
  p_extras jsonb
)
returns setof public.day_extras
language plpgsql
security definer
set search_path = public
as $function$
declare
  tenant_uuid uuid := public.current_tenant_id();
  item jsonb;
  amount_value numeric;
begin
  if auth.uid() is null
     or tenant_uuid is null
     or public.current_user_role() is distinct from 'owner' then
    raise exception 'Ручные финансы доступны только владельцу'
      using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_team_id, '')), '') is null
     or not exists (
       select 1 from public.teams team
        where team.tenant_id = tenant_uuid and team.id = p_team_id
     ) then
    raise exception 'Команда не найдена в этой компании'
      using errcode = '23503';
  end if;
  if p_date is null
     or p_date !~ '^\d{4}-\d{2}-\d{2}$'
     or (p_date::date)::text <> p_date then
    raise exception 'Дата ручной операции некорректна'
      using errcode = '22023';
  end if;
  if p_extras is null or jsonb_typeof(p_extras) <> 'array' then
    raise exception 'Список ручных операций повреждён'
      using errcode = '22023';
  end if;
  if jsonb_array_length(p_extras) > 200 then
    raise exception 'Слишком много ручных операций за один день'
      using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(p_extras)
  loop
    if jsonb_typeof(item) <> 'object'
       or exists (
         select 1 from jsonb_object_keys(item) key
          where key not in (
            'id', 'name', 'amount', 'kind', 'category',
            'payment_method', 'receipt_url'
          )
       )
       or jsonb_typeof(item -> 'id') <> 'string'
       or jsonb_typeof(item -> 'name') <> 'string'
       or jsonb_typeof(item -> 'amount') <> 'number'
       or jsonb_typeof(item -> 'kind') <> 'string'
       or nullif(btrim(item ->> 'name'), '') is null
       or char_length(btrim(item ->> 'name')) > 500
       or (item ->> 'kind') not in ('income', 'expense')
       or (
         item ? 'category'
         and item -> 'category' <> 'null'::jsonb
         and (
           jsonb_typeof(item -> 'category') <> 'string'
           or (item ->> 'category') not in ('fuel', 'food', 'supplies', 'other')
         )
       )
       or (
         item ? 'payment_method'
         and item -> 'payment_method' <> 'null'::jsonb
         and (
           jsonb_typeof(item -> 'payment_method') <> 'string'
           or (item ->> 'payment_method') not in ('cash', 'card', 'transfer', 'other')
         )
       )
       or (
         item ? 'receipt_url'
         and item -> 'receipt_url' <> 'null'::jsonb
         and (
           jsonb_typeof(item -> 'receipt_url') <> 'string'
           or char_length(item ->> 'receipt_url') > 2048
         )
       ) then
      raise exception 'Ручная операция содержит некорректные поля'
        using errcode = '22023';
    end if;

    begin
      perform (item ->> 'id')::uuid;
      amount_value := (item ->> 'amount')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Идентификатор или сумма ручной операции некорректны'
        using errcode = '22023';
    end;
    if amount_value = 'NaN'::numeric
       or amount_value < 0
       or amount_value > 999999999.99
       or round(amount_value, 2) is distinct from amount_value then
      raise exception 'Сумма ручной операции некорректна'
        using errcode = '22023';
    end if;
  end loop;

  if (
    select count(distinct (value ->> 'id')::uuid)
      from jsonb_array_elements(p_extras)
  ) <> jsonb_array_length(p_extras) then
    raise exception 'Ручные операции не должны повторяться'
      using errcode = '23505';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(tenant_uuid::text || ':' || p_team_id || ':' || p_date, 0)
  );

  delete from public.day_extras extra
   where extra.tenant_id = tenant_uuid
     and extra.team_id = p_team_id
     and extra.date = p_date;

  insert into public.day_extras (
    id, tenant_id, team_id, date, name, amount, kind, category,
    payment_method, receipt_url
  )
  select
    (value ->> 'id')::uuid,
    tenant_uuid,
    p_team_id,
    p_date,
    btrim(value ->> 'name'),
    (value ->> 'amount')::numeric,
    value ->> 'kind',
    value ->> 'category',
    value ->> 'payment_method',
    value ->> 'receipt_url'
  from jsonb_array_elements(p_extras);

  return query
    select extra.*
      from public.day_extras extra
     where extra.tenant_id = tenant_uuid
       and extra.team_id = p_team_id
       and extra.date = p_date
     order by extra.created_at, extra.id;
end;
$function$;

revoke all on function public.replace_day_extras(text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_day_extras(text, text, jsonb)
  to authenticated;

do $audit$
begin
  if has_function_privilege(
       'anon', 'public.replace_day_extras(text,text,jsonb)', 'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated', 'public.replace_day_extras(text,text,jsonb)', 'EXECUTE'
     ) then
    raise exception 'Atomic day extras RPC grants are unsafe';
  end if;
end;
$audit$;
