-- БРОШЕННЫЕ РЕГИСТРАЦИИ УДАЛЯЮТСЯ ЧЕРЕЗ 7 ДНЕЙ (владелец 04.10: «выполняй всё»).
--
-- С 04.10 почта подтверждается кодом. Аккаунт и его пустая заготовка
-- (handle_new_user: tenants, tenant_members, calendar_settings, реквизиты)
-- создаются в момент регистрации, ДО кода. Ошибся адресом, передумал, бот —
-- и заготовка лежала бы вечно, а адрес почты оставался бы занят.
--
-- Удаляется только то, что гарантированно пусто:
--   • почта не подтверждена и ни одного входа не было (`last_sign_in_at`);
--     без подтверждения войти нельзя, значит и завести данные было нечем;
--   • старше 7 дней — код живёт час, неделя с запасом на «отложил на потом»;
--   • заготовка — только та, где этот человек единственный участник.
-- Каждый аккаунт — в своём блоке: отказ одного (чужой внешний ключ) не
-- останавливает остальных. Запускает cron раз в сутки.

create or replace function public.purge_unconfirmed_signups()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user record;
  v_count integer := 0;
begin
  for v_user in
    select u.id
      from auth.users u
     where u.email_confirmed_at is null
       and u.last_sign_in_at is null
       and u.created_at < now() - interval '7 days'
     order by u.created_at
     limit 500
  loop
    begin
      delete from public.tenants t
       where exists (
               select 1 from public.tenant_members m
                where m.tenant_id = t.id
                  and m.user_id = v_user.id
                  and m.role = 'owner'
             )
         and not exists (
               select 1 from public.tenant_members o
                where o.tenant_id = t.id
                  and o.user_id <> v_user.id
             );
      delete from auth.users where id = v_user.id;
      v_count := v_count + 1;
    exception when others then
      raise warning 'purge_unconfirmed_signups: % пропущен (%)', v_user.id, sqlerrm;
    end;
  end loop;
  return v_count;
end;
$$;

-- Новая функция по умолчанию исполнима для PUBLIC и anon — снимаем сразу.
revoke all on function public.purge_unconfirmed_signups() from public, anon, authenticated;

select cron.schedule(
  'purge-unconfirmed-signups',
  '27 3 * * *',
  $cron$select public.purge_unconfirmed_signups()$cron$
);
