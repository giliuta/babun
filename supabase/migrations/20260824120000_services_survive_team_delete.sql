-- ПРАЙС БОЛЬШЕ НЕ ИСЧЕЗАЕТ ВМЕСТЕ С БРИГАДОЙ.
--
-- Что было: `services_team_fk` стоял с `ON DELETE CASCADE` (снимок прода,
-- воспроизведён файлом `20260817195637_services_belong_to_one_team.sql`).
-- Удаление бригады сносило её прайс ЖЁСТКО — мимо мягкого удаления, на
-- котором стоит весь продукт. Цена этому известна поимённо: на проде
-- 2026-08-24 семнадцать записей из двадцати ссылаются на четыре услуги,
-- которых больше нет, и десять из них — у живого тенанта. Имя услуги
-- нигде не дублируется (снимок `appointments.services[]` хранит только
-- id, цену и минуты), поэтому вместе с строкой каталога пропало и слово:
-- в майских записях владельца стоит безымянная «Услуга».
--
-- Закон продукта уже записан соседней миграцией `20260809100000`:
-- справочная запись, на которую ссылается история, ВЫКЛЮЧАЕТСЯ, а не
-- стирается. Здесь он распространяется на услуги.
--
-- Новое поведение удаления бригады:
--   • её услуга встречается хоть в одной записи → удалить бригаду НЕЛЬЗЯ,
--     ошибка называет услугу; такую бригаду выключают;
--   • услуги, которых нет ни в одной записи, уходят вместе с бригадой —
--     терять там нечего, и владелец не остаётся с прайсом-сиротой;
--   • `ON DELETE CASCADE` снят: под сторожем каскад лишний, а как молчаливый
--     запасной путь он и есть тот самый дефект. Осталcя `RESTRICT` —
--     последняя страховка на случай, если сторож когда-нибудь обойдут.

create or replace function public.guard_team_delete_with_history()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  n_appointments integer;
  n_accounts integer;
  n_transactions integer;
  used_services text;
begin
  -- Снесённый тенант уносит всё за собой — там проверять нечего.
  if not exists (select 1 from public.tenants where id = old.tenant_id) then
    return old;
  end if;

  select count(*) into n_appointments
    from public.appointments where team_id = old.id;
  select count(*) into n_accounts
    from public.accounts where brigade_id = old.id;
  select count(*) into n_transactions
    from public.finance_transactions where team_id = old.id;

  if n_appointments > 0 or n_accounts > 0 or n_transactions > 0 then
    raise exception
      'У команды есть история: записей %, счетов %, операций %. Такую команду выключают, а не удаляют.',
      n_appointments, n_accounts, n_transactions
      using errcode = '23503';
  end if;

  -- Услуга живёт у одной команды, но в записи могла попасть к любой:
  -- каталог в листе записи до сих пор не сужен до бригады. Поэтому
  -- спрашиваем не «есть ли записи у команды», а «помнит ли хоть одна
  -- запись хоть одну её услугу».
  select string_agg(s.name, ', ' order by s.name) into used_services
    from public.services s
   where s.tenant_id = old.tenant_id
     and s.team_id = old.id
     and exists (
       select 1 from public.appointments a
        where a.tenant_id = old.tenant_id
          and coalesce(a.service_ids, '[]'::jsonb) ? s.id
     );

  if used_services is not null then
    raise exception
      'Услуги команды стоят в записях: %. Такую команду выключают, а не удаляют — иначе записи потеряют название услуги.',
      used_services
      using errcode = '23503';
  end if;

  -- Остальное — прайс, о котором не помнит ни одна запись. Он уходит вместе
  -- с бригадой явно, а не тайным каскадом: `RESTRICT` ниже иначе не пустит.
  delete from public.services
   where tenant_id = old.tenant_id and team_id = old.id;

  return old;
end;
$$;

drop trigger if exists trg_guard_team_delete_history on public.teams;
create trigger trg_guard_team_delete_history
  before delete on public.teams
  for each row execute function public.guard_team_delete_with_history();

alter table public.services drop constraint if exists services_team_fk;
alter table public.services
  add constraint services_team_fk
  foreign key (tenant_id, team_id)
  references public.teams(tenant_id, id)
  on delete restrict;
