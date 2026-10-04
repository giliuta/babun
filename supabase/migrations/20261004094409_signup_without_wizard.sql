-- РЕГИСТРАЦИЯ БЕЗ МАСТЕРА (владелец 04.10).
--
-- «Как называется ваш бизнес» и «Чем вы занимаетесь» сняты: зарегистрироваться
-- может кто угодно — партнёр без своего бизнеса тоже, а род занятий нигде в
-- продукте не светится. Имя аккаунта теперь одно поле экрана регистрации —
-- «Имя или название компании» (`full_name` в метаданных), и аккаунт готов к
-- работе сразу: `onboarded_at` ставится в момент регистрации.
--
-- Почему `onboarded_at` нужен вообще: приглашение партнёров (`create_invitation`,
-- ветка приглашения ниже) требует настроенный аккаунт. Без мастера ставить его
-- больше некому.
--
-- ПРАВКА ОДНОГО БЛОКА ЖИВОГО ТЕЛА: тело берётся из базы, сверяется md5
-- (316afa0c…, 04.10), меняется ровно вставка аккаунта. Тело поменяли с тех
-- пор — миграция падает, а не затирает чужое.

do $migration$
declare
  fn regprocedure := 'public.handle_new_user()'::regprocedure;
  def text;
  old_insert text := $old$  insert into public.tenants (id, name, vertical)
  values (
    gen_random_uuid(),
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'business_name'), ''),
      new.email,
      'Компания'
    ),
    'other'
  )$old$;
  new_insert text := $new$  -- ИМЯ АККАУНТА — С ЭКРАНА РЕГИСТРАЦИИ, АККАУНТ ГОТОВ СРАЗУ (04.10):
  -- мастера «название бизнеса / род занятий» больше нет.
  insert into public.tenants (id, name, vertical, onboarded_at)
  values (
    gen_random_uuid(),
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'business_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      new.email,
      'Аккаунт'
    ),
    'other',
    now()
  )$new$;
begin
  if (select md5(prosrc) from pg_proc where oid = fn) <> '316afa0c94848b5305c35b46537f5499' then
    raise exception 'handle_new_user изменилась после 04.10 — перечитать тело перед правкой';
  end if;
  def := pg_get_functiondef(fn);
  if (length(def) - length(replace(def, old_insert, ''))) / length(old_insert) <> 1 then
    raise exception 'вставка аккаунта не найдена ровно один раз';
  end if;
  execute replace(def, old_insert, new_insert);
end
$migration$;

-- Аккаунты, застрявшие перед мастером: готовы сразу. Имя, которое триггер
-- поставил адресом почты, меняется на имя с регистрации — и у реквизитов по
-- умолчанию тоже, если их ещё не трогали (они родились с тем же именем).
with stuck as (
  select t.id as tenant_id,
         t.name as old_name,
         nullif(btrim(u.raw_user_meta_data ->> 'full_name'), '') as full_name,
         u.email
    from public.tenants t
    join public.tenant_members m on m.tenant_id = t.id and m.role = 'owner'
    join auth.users u on u.id = m.user_id
   where t.onboarded_at is null
),
renamed as (
  update public.tenants t
     set onboarded_at = now(),
         name = case
                  when s.full_name is not null and t.name = s.email then s.full_name
                  else t.name
                end
    from stuck s
   where t.id = s.tenant_id
  returning t.id, s.old_name, t.name as new_name
)
update public.legal_entities le
   set name = r.new_name
  from renamed r
 where le.tenant_id = r.id
   and le.is_default
   and le.name = r.old_name
   and r.new_name <> r.old_name;
