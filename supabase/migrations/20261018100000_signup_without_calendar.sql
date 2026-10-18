-- ПЕРВЫЙ ВХОД КАК ОБУЧЕНИЕ (STORY-102).
--
-- 1. Регистрация больше не заводит календарь «Личный»: первый календарь
--    человек создаёт сам на обучении и сам даёт ему имя
--    (`create_first_calendar`: владелец, под замком аккаунта, один раз).
-- 2. Прогресс обучения — `onboarding_progress`: какие главы человек прошёл в
--    своём аккаунте. Строку получает только НОВЫЙ владелец при регистрации;
--    у тех, кто уже работает, строки нет — и обучения у них нет совсем.
--
-- Своя таблица, а не колонка `tenant_members`: каждое изменение той строки
-- пишется в «Историю изменений» (`zz_log_change`) и уходит уведомлением
-- команде, а «прошёл главу обучения» — не событие команды.
--
-- `ensure_personal_space` правится ПО ТЕКСТУ: на боевой стоит версия до
-- дочистки 20261013100000 (с `personal_of`), в файлах — версия после неё.
-- Кусок с календарём в обеих одинаковый, поэтому правка ложится на любую.
-- Дочистку 20261013100000 накатывать ДО этого файла: её `create or replace`
-- вернул бы календарь в регистрацию.

create table if not exists public.onboarding_progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  -- Пройденные главы: calendar · finances · clients · cabinet.
  done text[] not null default '{}',
  created_at timestamptz not null default now(),
  primary key (user_id, tenant_id)
);

-- Читается и пишется только функциями ниже: своя строка в своём аккаунте.
alter table public.onboarding_progress enable row level security;
revoke all on table public.onboarding_progress from public, anon, authenticated;

do $$
declare
  v_def text;
  v_old text;
begin
  select pg_get_functiondef('public.ensure_personal_space(uuid)'::regprocedure) into v_def;
  v_old := $q$  insert into public.teams (id, tenant_id, name, payout_percentage)
  values (
    'team-' || replace(gen_random_uuid()::text, '-', ''),
    v_tenant,
    public.personal_calendar_name(v_meta ->> 'locale'),
    30
  );
$q$;
  if position(v_old in v_def) = 0 then
    raise exception 'ensure_personal_space: якорь вставки календаря не найден';
  end if;
  v_def := replace(v_def, v_old, $q$  insert into public.onboarding_progress (user_id, tenant_id)
  values (p_user, v_tenant)
  on conflict do nothing;
$q$);
  execute v_def;
end;
$$;

revoke all on function public.ensure_personal_space(uuid) from public, anon, authenticated;

comment on function public.ensure_personal_space(uuid) is
  'Аккаунт нового человека: аккаунт с его именем, он владелец, настройки календаря, обучение с нуля. Календаря нет — первый человек заводит сам (create_first_calendar). Уже владеет аккаунтом — вернуть его. Только для функций базы (зовёт handle_new_user).';

/** Пройденные главы обучения в текущем аккаунте; null — обучения нет. */
create or replace function public.my_onboarding()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select p.done
    from public.onboarding_progress p
   where p.user_id = auth.uid()
     and p.tenant_id = public.current_tenant_id();
$$;

/** Отметить главу пройденной; 'all' — всё обучение сразу. Пишет только свою
 *  строку и только если обучение у человека есть. */
create or replace function public.onboarding_done(p_chapter text)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_all constant text[] := array['calendar', 'finances', 'clients', 'cabinet'];
  v_done text[];
begin
  if auth.uid() is null then
    raise exception 'Войдите в приложение' using errcode = '42501';
  end if;
  if p_chapter is null or not (p_chapter = 'all' or p_chapter = any (v_all)) then
    raise exception 'Нет такой главы обучения' using errcode = '22023';
  end if;

  update public.onboarding_progress p
     set done = case
       when p_chapter = 'all' then v_all
       when p_chapter = any (p.done) then p.done
       else p.done || p_chapter
     end
   where p.user_id = auth.uid()
     and p.tenant_id = public.current_tenant_id()
  returning p.done into v_done;

  return v_done;
end;
$$;

revoke all on function public.my_onboarding() from public, anon;
revoke all on function public.onboarding_done(text) from public, anon;
grant execute on function public.my_onboarding() to authenticated;
grant execute on function public.onboarding_done(text) to authenticated;
