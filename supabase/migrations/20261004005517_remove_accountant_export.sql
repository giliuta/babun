-- «ВЫГРУЗКА ДЛЯ БУХГАЛТЕРА» УДАЛЕНА (владелец 03.10: «давай удалим полностью
-- выгрузку для бухгалтера — с настроек удалим и из доступа удалим, это мне
-- кажется ненужно вообще»).
--
-- Право `finance.settings_export` (строка шестерёнки «Финансов», миграция
-- 20261003235500) уходит из реестра. Сервер его ничем не держал — файл
-- собирался на телефоне, — поэтому ни функций, ни политик не трогаем. На
-- 03.10 у права не было ни одной выставленной строки, приглашения и шаблона
-- (сверено); чистка ниже — на случай, если они появятся до наката.

set local lock_timeout = '5s';

delete from public.member_access where block = 'finance.settings_export';

update public.invitations i
   set access_changes = coalesce((
     select jsonb_agg(change)
       from jsonb_array_elements(i.access_changes) as change
      where change->>'block' is distinct from 'finance.settings_export'
   ), '[]'::jsonb)
 where jsonb_typeof(i.access_changes) = 'array'
   and exists (
     select 1 from jsonb_array_elements(i.access_changes) as change
      where change->>'block' = 'finance.settings_export'
   );

update public.access_templates
   set levels = levels - 'finance.settings_export'
 where levels ? 'finance.settings_export';

delete from public.access_blocks where key = 'finance.settings_export';

do $guard$
begin
  if exists (select 1 from public.access_blocks where key = 'finance.settings_export') then
    raise exception 'сторож: право выгрузки осталось в реестре';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosrc like '%settings_export%'
  ) then
    raise exception 'сторож: функция всё ещё спрашивает право выгрузки';
  end if;
end
$guard$;
