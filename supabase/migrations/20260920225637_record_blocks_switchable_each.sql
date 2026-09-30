-- STORY-084: сама ЗАПИСЬ разбирается на блоки.
--
-- Владелец 21.09: «то же самое нужно сделать с каждым блоком… клиент — видит
-- он клиента или не видит; объект — видит или не видит; метка — видит, не
-- видит или может редактировать; потом оплата — скрыт, смотрит, меняет; потом
-- услуги — то же самое; потом в услугах „Итого" — тоже. Каждый блок в каждой
-- записи мы прописываем, что он может делать и что не может».
--
-- ИМЕНА — ТЕ, ЧТО ВЛАДЕЛЕЦ УЖЕ ВИДИТ. Блоки формы записи заданы самим
-- продуктом (`BOOKING_BLOCKS`: Команда, Метка, Время, Клиент, Объект, Услуги,
-- Оплата, Заметка, Файлы) и настраиваются в «Кабинет → Запись». Права режутся
-- ровно по этим швам, чтобы не появилось второго словаря для одного и того же.
--
-- «Итого» отдельным блоком не заводится: оно и есть `record.amount` («Сумма
-- записи») — цена строки и скидка считают его, и двух переключателей на одно
-- число быть не должно.
--
-- «Заводить новых клиентов из записи» — тоже не новый блок: это «Клиенты:
-- Меняет». Один и тот же запрет не может жить в двух местах.
--
-- `live = false` у всех: строка появится на странице прав в день своей волны.

update public.access_blocks
   set title_ru = 'Статус записи'
 where key = 'record.status';

insert into public.access_blocks (key, area, scope, levels, title_ru, owner_only, position) values
  ('calendar.move',        'calendar', 'calendar', array['off','write'],        'Переносить и копировать записи', false, 26),
  ('calendar.event_types', 'calendar', 'company',  array['off','read','write'], 'Типы событий',                   false, 27),
  ('record.team',          'calendar', 'calendar', array['off','read','write'], 'Команда и мастер записи',        false, 31),
  ('record.label',         'calendar', 'calendar', array['off','read','write'], 'Метка записи',                   false, 32),
  ('record.when',          'calendar', 'calendar', array['off','read','write'], 'Время записи',                   false, 33),
  ('record.client',        'calendar', 'calendar', array['off','read','write'], 'Клиент в записи',                false, 34),
  ('record.object',        'calendar', 'calendar', array['off','read','write'], 'Объект в записи',                false, 35),
  ('record.services',      'calendar', 'calendar', array['off','read','write'], 'Услуги в записи',                false, 36),
  ('record.note',          'calendar', 'calendar', array['off','read','write'], 'Заметка записи',                 false, 37)
on conflict (key) do nothing;

do $guard$
declare
  total integer;
  live_count integer;
  missing text;
begin
  select count(*), count(*) filter (where live) into total, live_count
    from public.access_blocks;
  if total < 52 then
    raise exception 'STORY-084 сторож: блоков в реестре % — вставка не прошла', total;
  end if;
  if live_count <> 7 then
    raise exception 'STORY-084 сторож: живых блоков стало % — новые не должны оживать сами', live_count;
  end if;

  -- Каждый блок формы записи получил свою строку прав.
  select b into missing
    from unnest(array[
      'record.team','record.label','record.when','record.client',
      'record.object','record.services','record.note','record.payment','record.files'
    ]) as b
   where not exists (select 1 from public.access_blocks a where a.key = b)
   limit 1;
  if missing is not null then
    raise exception 'STORY-084 сторож: у блока записи % нет строки прав', missing;
  end if;
end
$guard$;
