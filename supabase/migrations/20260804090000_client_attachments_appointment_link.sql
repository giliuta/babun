-- Вложения знают, из какой ЗАПИСИ они пришли.
--
-- Владелец 2026-08-03: «полноценно открывается страница, где вся документация
-- о клиенте — все документы, все чеки, все инвойсы, все фотографии; всё, что
-- было проведено когда-либо в записях у клиента, автоматически отправляется
-- во вкладку вложения».
--
-- До этой миграции вложение принадлежало только КЛИЕНТУ: чек, снятый на
-- выезде, невозможно было связать с визитом, и «автоматически из записей»
-- собирать было не из чего.
--
-- ON DELETE SET NULL, а не CASCADE: удалённая запись не уносит с собой
-- документ. Чек и акт — бухгалтерия клиента, они переживают отмену визита и
-- остаются на его странице вложений без пометки о записи.

alter table public.client_attachments
  add column if not exists appointment_id uuid
    references public.appointments(id) on delete set null;

-- Выборка «файлы этой записи» на экране записи.
create index if not exists idx_client_attachments_appointment
  on public.client_attachments(appointment_id)
  where appointment_id is not null;

comment on column public.client_attachments.appointment_id is
  'Запись, на которой файл был приложен. NULL — файл заведён на карточке клиента или его запись удалена.';
