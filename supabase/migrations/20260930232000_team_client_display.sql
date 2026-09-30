-- ВИД КЛИЕНТОВ У КОМАНДЫ — НА СЕРВЕРЕ (владелец 30.09: «способы связи и карты
-- для маршрута — всё должно правильно проходить»; «да, накатывай»; «дубли
-- тоже делай, обслуживание тоже»).
--
-- До этой миграции «Строка в списке», «Способы связи» и «Карты для маршрута»
-- жили на ТЕЛЕФОНЕ (MMKV) ключом команды: владелец настраивал «Команду 1», а у
-- его сотрудников в «Команде 1» оставалось по-старому. Теперь это строка
-- `team_design` — одна на команду, читают все члены компании, правит
-- владелец (политики таблицы не меняются).
--
-- Все новые поля ПУСТЫЕ (NULL = «команда ещё не настраивала на сервере»):
-- приложение тогда берёт прежний набор с телефона и при первой правке
-- записывает его сюда. Настроенное на телефоне не пропадает.
--
-- • client_list_off      — какие поля строки списка выключены;
-- • contact_ways         — способы связи {"enabled":[…], "order":[…]};
-- • map_services         — карты для маршрута, тот же вид;
-- • service_every_months — «пора обслужить» объекта без своего интервала;
-- • disabled_blocks += client_note, client_objects, client_labels,
--   client_personal — ещё четыре выключаемых блока страницы клиента.

set local lock_timeout = '5s';

alter table public.team_design
  add column if not exists client_list_off text[],
  add column if not exists contact_ways jsonb,
  add column if not exists map_services jsonb,
  add column if not exists service_every_months integer;

alter table public.team_design drop constraint if exists team_design_client_list_known;
alter table public.team_design add constraint team_design_client_list_known check (
  client_list_off is null
  or client_list_off <@ array['phone', 'exp', 'inc', 'debt', 'last', 'meta']::text[]
);

alter table public.team_design drop constraint if exists team_design_ordered_sets_shape;
alter table public.team_design add constraint team_design_ordered_sets_shape check (
  (contact_ways is null or (
    jsonb_typeof(contact_ways) = 'object'
    and jsonb_typeof(contact_ways -> 'enabled') = 'array'
    and jsonb_typeof(contact_ways -> 'order') = 'array'
  ))
  and (map_services is null or (
    jsonb_typeof(map_services) = 'object'
    and jsonb_typeof(map_services -> 'enabled') = 'array'
    and jsonb_typeof(map_services -> 'order') = 'array'
  ))
);

alter table public.team_design drop constraint if exists team_design_service_months_range;
alter table public.team_design add constraint team_design_service_months_range check (
  service_every_months is null or service_every_months between 1 and 60
);

alter table public.team_design drop constraint if exists team_design_blocks_known;
alter table public.team_design add constraint team_design_blocks_known check (
  disabled_blocks <@ array[
    'record_label', 'record_object', 'record_payment', 'record_note', 'record_files',
    'event_label', 'event_type', 'event_client', 'event_object', 'event_note', 'event_files',
    'client_people', 'client_requisites', 'client_files',
    'client_note', 'client_objects', 'client_labels', 'client_personal'
  ]::text[]
);

do $guard$
begin
  if exists (
    select 1 from public.team_design
     where client_list_off is not null
        or contact_ways is not null
        or map_services is not null
        or service_every_months is not null
  ) then
    raise exception 'team_client_display: new columns must start empty';
  end if;
end;
$guard$;
