-- SMS, ВОЛНА 1 (STORY-089): «ШАБЛОНЫ SMS» — ЖИВОЕ ПРАВО.
--
-- Шаблоны читали и писали только владелец и диспетчер (роль диспетчера
-- закрыта 24.09 — значит, только владелец). Мастер, который пишет клиенту
-- со своего телефона из записи, шаблонов не видел вовсе. Строка прав
-- «Шаблоны SMS» стояла в реестре неживой.
--
-- Теперь: читает тот, у кого «Шаблоны SMS: Видит», правит — «Меняет»;
-- владелец — всегда (`access_company` пускает его сам). Тела переписаны со
-- снятого `pg_proc.prosrc`; изменена только проверка входа.

create or replace function public.read_sms_templates_safe()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_state jsonb;
begin
  if auth.uid() is null
     or not coalesce(public.access_company('company.sms_templates', 'read'), false) then
    raise exception 'sms templates require access'
      using errcode = '42501';
  end if;

  select ts.prototype_state
    into v_state
    from public.tenant_state ts
   where ts.tenant_id = public.current_tenant_id();

  return jsonb_build_object(
    'present', coalesce(v_state ? 'smsTemplates', false),
    'templates', case
      when coalesce(v_state ? 'smsTemplates', false)
        then v_state -> 'smsTemplates'
      else '[]'::jsonb
    end
  );
end;
$function$;

create or replace function public.write_sms_templates_safe(p_templates jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null
     or not coalesce(public.access_company('company.sms_templates', 'write'), false) then
    raise exception 'sms templates require access'
      using errcode = '42501';
  end if;

  if p_templates is null or jsonb_typeof(p_templates) <> 'array' then
    raise exception 'sms templates must be an array'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_templates) > 200
     or exists (
       select 1
        from jsonb_array_elements(p_templates) item
        where jsonb_typeof(item) <> 'object'
           or jsonb_typeof(item -> 'id') is distinct from 'string'
           or jsonb_typeof(item -> 'body') is distinct from 'string'
           or length(item ->> 'id') > 200
           or length(item ->> 'body') > 5000
     ) then
    raise exception 'sms templates payload is invalid'
      using errcode = '22023';
  end if;

  insert into public.tenant_state (tenant_id, prototype_state, updated_at)
  values (
    public.current_tenant_id(),
    jsonb_build_object('smsTemplates', p_templates),
    now()
  )
  on conflict (tenant_id) do update
     set prototype_state = jsonb_set(
           coalesce(public.tenant_state.prototype_state, '{}'::jsonb),
           '{smsTemplates}',
           p_templates,
           true
         ),
         updated_at = now();

  return p_templates;
end;
$function$;

update public.access_blocks
   set live = true,
       enforced_by = array[
         'function:public.read_sms_templates_safe()',
         'function:public.write_sms_templates_safe(jsonb)'
       ]
 where key = 'company.sms_templates';

do $audit$
begin
  if not exists (select 1 from public.access_blocks where key = 'company.sms_templates' and live) then
    raise exception 'company.sms_templates is not live';
  end if;
  if has_function_privilege('anon', 'public.read_sms_templates_safe()', 'execute')
     or has_function_privilege('anon', 'public.write_sms_templates_safe(jsonb)', 'execute') then
    raise exception 'sms template functions are callable by anon';
  end if;
end
$audit$;
