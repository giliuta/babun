-- ДВУХФАКТОРНЫЙ ВХОД — НА СЕРВЕРЕ.
--
-- В приложении второй шаг держит гейт входа: сессия первого уровня (`aal1`,
-- только пароль, Google, Apple или ссылка из письма) наружу не отдаётся, пока
-- человек не введёт код из приложения-аутентификатора. Но это замок только в
-- новом приложении: старая сборка или прямой вызов API с паролем получили бы
-- данные без кода.
--
-- Здесь — тот же закон для базы. У каждой таблицы `public` с RLS появляется
-- ОГРАНИЧИВАЮЩАЯ политика `mfa_required`: кто включил двухфакторный вход
-- (подтверждённый фактор в `auth.mfa_factors`), тот читает и пишет только с
-- токеном `aal2`. У кого фактора нет — ничего не меняется. Ограничивающая
-- политика складывается через И со всеми остальными, поэтому прав она не
-- добавляет, а только запирает сессию без кода.
--
-- Чего политика не держит:
--   • функции SECURITY DEFINER обходят RLS — их двери (`set_member_access`,
--     оплата записи и прочие) с токеном `aal1` по-прежнему открыты;
--   • `storage.objects` (файлы) — таблица не наша, политика там отдельным шагом;
--   • служебный ключ (функции Edge) — как и раньше, без RLS.
--
-- Побочка для старых сборок (1.0.3 обновлений по воздуху не получает): человек
-- с двухфакторным входом после входа паролем увидит пустые экраны вместо
-- экрана кода. У кого фактора нет — всё как было.

set local lock_timeout = '5s';

create or replace function public.mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (
        select 1
          from auth.mfa_factors f
         where f.user_id = auth.uid()
           and f.status = 'verified'
      )
$function$;

comment on function public.mfa_satisfied() is
  'Сессия прошла двухфакторный вход, если он включён у человека. Для политики mfa_required.';

revoke all on function public.mfa_satisfied() from public, anon;
grant execute on function public.mfa_satisfied() to authenticated;

do $$
declare
  r record;
begin
  for r in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and c.relrowsecurity
  loop
    execute format('drop policy if exists mfa_required on public.%I', r.relname);
    execute format(
      'create policy mfa_required on public.%I as restrictive for all to authenticated '
      'using ((select public.mfa_satisfied())) with check ((select public.mfa_satisfied()))',
      r.relname
    );
  end loop;
end;
$$;

-- ─── Сторож ──────────────────────────────────────────────────────────────

do $$
declare
  v_missing integer;
begin
  select count(*) into v_missing
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r', 'p')
     and c.relrowsecurity
     and not exists (
       select 1 from pg_policy p where p.polrelid = c.oid and p.polname = 'mfa_required' and not p.polpermissive
     );
  if v_missing > 0 then
    raise exception 'mfa_required: % таблиц(ы) без политики', v_missing;
  end if;
  if has_function_privilege('anon', 'public.mfa_satisfied()', 'execute') then
    raise exception 'mfa_required: mfa_satisfied исполнима для anon';
  end if;
end;
$$;
