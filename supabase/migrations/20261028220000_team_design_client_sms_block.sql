-- БЛОК SMS КАРТОЧКИ КЛИЕНТА ВЫКЛЮЧАЕТСЯ КОМАНДОЙ, КАК ОСТАЛЬНЫЕ БЛОКИ.
--
-- «Блоки клиентов» получили строку «SMS» (ключ `client_sms`), а проверка
-- `team_design_blocks_known` знает только прежние ключи: без неё выключить
-- SMS нельзя — запись отбивается нарушением ограничения. Расширяем список
-- одним ключом; остальное как было.

alter table public.team_design drop constraint team_design_blocks_known;
alter table public.team_design add constraint team_design_blocks_known check (
  disabled_blocks <@ array[
    'record_label', 'record_object', 'record_payment', 'record_note', 'record_files',
    'event_label', 'event_type', 'event_client', 'event_object', 'event_note', 'event_files',
    'client_people', 'client_requisites', 'client_files', 'client_note', 'client_objects',
    'client_labels', 'client_personal', 'client_tags', 'client_sms'
  ]::text[]
);
