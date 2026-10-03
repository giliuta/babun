-- «МЕТКА» И «ТЕГ» — ДВА БЛОКА КАРТОЧКИ КЛИЕНТА (владелец 03.10: «заметка,
-- личная, метка, тег — кстати сделать раздельно»).
--
-- До этой миграции один выключатель `client_labels` гасил обе плитки сразу.
-- Теперь у тега свой ключ `client_tags` в `team_design.disabled_blocks`.
-- Поведение не меняется: команды, где «Метка и тег» были выключены, получают
-- выключенным и тег — включить его можно отдельно на странице «Блоки
-- клиентов».

set local lock_timeout = '5s';

alter table public.team_design drop constraint if exists team_design_blocks_known;
alter table public.team_design add constraint team_design_blocks_known check (
  disabled_blocks <@ array[
    'record_label', 'record_object', 'record_payment', 'record_note', 'record_files',
    'event_label', 'event_type', 'event_client', 'event_object', 'event_note', 'event_files',
    'client_people', 'client_requisites', 'client_files',
    'client_note', 'client_objects', 'client_labels', 'client_personal',
    'client_tags'
  ]::text[]
);

update public.team_design
   set disabled_blocks = disabled_blocks || array['client_tags']
 where 'client_labels' = any(disabled_blocks)
   and not ('client_tags' = any(disabled_blocks));
