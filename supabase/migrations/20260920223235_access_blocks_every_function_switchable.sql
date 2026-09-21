-- STORY-084: каждая функция — свой переключатель.
--
-- Владелец 21.09: «я хочу отключать поблочно каждую функцию… надо всё, каждый
-- блок расписать в правилах, чтобы можно было каждый блок отключать», и о
-- положениях: «не видит, видит и имеет доступ к редактированию — три правила
-- разрешений по сути на каждый блок».
--
-- Здесь заводятся ТОЛЬКО СТРОКИ РЕЕСТРА. `live` у всех false — значит на
-- странице прав их ещё нет и сервер их не проверяет (`offeredBlocks`
-- показывает только живые). Блок появится строкой ровно в тот день, когда у
-- него появится сторож на сервере, — своей волной. Так реестр описывает план
-- целиком, но ничего не обещает раньше времени.
--
-- ДВА ПОЛОЖЕНИЯ ВМЕСТО ТРЁХ — ТАМ, ГДЕ СРЕДНЕЕ БЕССМЫСЛЕННО: «видеть импорт»
-- или «видеть объединение дублей» нечего, это действия; а у «Долга и визитов»
-- и «Статистики мастера» нечего менять — это витрина.
--
-- НЕ ЗАВОДИМ ПОКА (решение владельца 21.09): аналитика — «это другая фича,
-- я её в целом буду менять»; справочники тегов и типов объектов — «теги и всё
-- остальное это уже другое».

insert into public.access_blocks (key, area, scope, levels, title_ru, owner_only, position) values
  ('calendar.events',        'calendar', 'calendar', array['off','read','write'], 'События',                     false, 25),
  ('record.files',           'calendar', 'calendar', array['off','read','write'], 'Фото и файлы записи',         false, 55),
  ('calendar.schedule',      'calendar', 'calendar', array['off','read','write'], 'График команды',              false, 75),
  ('calendar.booking_form',  'calendar', 'company',  array['off','read','write'], 'Вид записи',                  false, 80),
  ('finance.operation_files','finance',  'calendar', array['off','read','write'], 'Файл к операции',             false, 115),
  ('finance.categories',     'finance',  'company',  array['off','read','write'], 'Категории операций',          false, 165),
  ('finance.templates',      'finance',  'company',  array['off','read','write'], 'Шаблоны операций',            false, 170),
  ('finance.vat',            'finance',  'company',  array['off','read','write'], 'НДС',                         false, 175),
  ('finance.invoicing',      'finance',  'company',  array['off','read','write'], 'Счета клиентам',              false, 180),
  ('clients.filters',        'clients',  'company',  array['off','read','write'], 'Фильтры клиентов',            false, 235),
  ('clients.share',          'clients',  'company',  array['off','read','write'], 'Делиться клиентами',          false, 240),
  ('clients.money',          'clients',  'company',  array['off','read'],         'Долг и визиты клиента',       false, 245),
  ('clients.history',        'clients',  'company',  array['off','read'],         'История записей клиента',     false, 250),
  ('clients.files',          'clients',  'company',  array['off','read','write'], 'Файлы клиента',               false, 255),
  ('clients.archive',        'clients',  'company',  array['off','read','write'], 'Архив и корзина',             false, 260),
  ('clients.merge',          'clients',  'company',  array['off','write'],        'Объединять дубли',            false, 265),
  ('clients.bulk_sms',       'clients',  'company',  array['off','write'],        'Рассылка по выбранным',       false, 270),
  ('clients.import',         'clients',  'company',  array['off','write'],        'Импорт клиентов',             false, 275),
  ('clients.flags',          'clients',  'company',  array['off','read','write'], 'Чёрный список и закрепление', false, 280),
  ('masters.money',          'company',  'company',  array['off','read'],         'Визиты и статистика мастера', false, 325),
  ('company.sms_templates',  'company',  'company',  array['off','read','write'], 'Шаблоны SMS',                 false, 350),
  ('company.inventory',      'company',  'company',  array['off','read','write'], 'Склад',                       false, 360)
on conflict (key) do nothing;

do $guard$
declare
  total integer;
  live_count integer;
  bad text;
begin
  select count(*), count(*) filter (where live) into total, live_count
    from public.access_blocks;
  if total < 43 then
    raise exception 'STORY-084 сторож: блоков в реестре % — вставка не прошла', total;
  end if;
  if live_count <> 7 then
    raise exception 'STORY-084 сторож: живых блоков стало % — новые не должны оживать сами', live_count;
  end if;

  -- Умолчание блока — его первое положение, и оно обязано быть «закрыто».
  select key into bad
    from public.access_blocks
   where levels[1] not in ('off', 'own', 'read')
   limit 1;
  if bad is not null then
    raise exception 'STORY-084 сторож: у блока % умолчание не закрытое', bad;
  end if;
end
$guard$;
