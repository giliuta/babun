-- STORY-084: заметку записи пишет тот, кто меняет статус. Отдельного
-- переключателя «Заметка записи» нет.
--
-- СЛОВО ВЛАДЕЛЬЦА, 21.09: «только если статус меняется — значит он может
-- писать заметку». Сервер так и устроен с волны 2: статус и заметку пишет одна
-- дверь, `update_master_appointment_safe`, и пускает её «Статус записи:
-- Меняет». Спящий блок `record.note` обещал второй переключатель на тот же
-- запрет — а один запрет не живёт в двух местах. Блок снят; читать заметку
-- можно при любом положении статуса (окно мастера отдаёт её всегда).
--
-- Уровней у блока не было ни у кого, ждущих приглашений с ним — ноль; строки
-- ниже чистят их на любой базе, где они всё же есть.

delete from public.member_access where block = 'record.note';

update public.invitations i
   set access_changes = (
     select coalesce(jsonb_agg(x.change order by x.ord), '[]'::jsonb)
       from jsonb_array_elements(i.access_changes) with ordinality as x(change, ord)
      where x.change ->> 'block' is distinct from 'record.note'
   )
 where i.accepted_at is null
   and jsonb_typeof(i.access_changes) = 'array'
   and i.access_changes @> '[{"block":"record.note"}]';

delete from public.access_blocks where key = 'record.note';

comment on function public.update_master_appointment_safe(uuid, jsonb) is
  'STORY-084: статус и заметку записи мастер пишет одной дверью — по «Статус записи: Меняет» в календаре записи (владелец 21.09: «если статус меняется — значит он может писать заметку»).';

do $guard$
begin
  if exists (select 1 from public.access_blocks where key = 'record.note') then
    raise exception 'STORY-084 сторож: блок record.note остался в реестре';
  end if;
  if exists (select 1 from public.member_access where block = 'record.note')
     or exists (
       select 1 from public.invitations i
        where i.accepted_at is null and jsonb_typeof(i.access_changes) = 'array'
          and i.access_changes @> '[{"block":"record.note"}]') then
    raise exception 'STORY-084 сторож: уровень record.note где-то остался';
  end if;
  -- Заметка по-прежнему пишется только дверью статуса.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'update_master_appointment_safe'
       and p.prosrc like '%access_calendars(''record.status'', ''write'')%'
       and p.prosrc like '%''comment''%'
  ) then
    raise exception 'STORY-084 сторож: заметку больше не пишет дверь статуса';
  end if;
end
$guard$;
