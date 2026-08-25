-- ДОГОН ДРЕЙФА СХЕМЫ: файл написан ЗАДНИМ ЧИСЛОМ.
--
-- ПОЧЕМУ ФАЙЛ ПОЯВИЛСЯ СПУСТЯ ТРИ МЕСЯЦА.
--   Поля личного события (`event_*`) были добавлены боевой базе напрямую,
--   мимо репозитория — версия 20260520201330 уже лежит в
--   supabase_migrations.schema_migrations, а файла к ней не было.
--   Прод от этого работает, а вот ЧИСТАЯ среда — новый клиент, восстановление,
--   CI, локальный `supabase start` — не поднималась ВООБЩЕ:
--     * 20260720210001_role_rls_hardening.sql сравнивает эти колонки в триггере
--       `appointments_master_column_guard()` — тело plpgsql при создании не
--       проверяется, поэтому оно падает не на миграции, а позже, на первой
--       правке записи;
--     * 20260720210003_master_privacy_hardening.sql и
--       20260720210010_team_event_visibility.sql читают их в проекции
--       `list_master_appointments_safe()`, а она `language sql` — вот ЭТИ тела
--       Postgres проверяет сразу, и вся цепочка миграций обрывалась с
--       «column a.event_all_day does not exist».
--   Ссылки намеренно по именам функций, а не по номерам строк: любая правка
--   соседнего файла сдвигает номера, и подсказка начинает врать (так уже
--   случилось — «:1144-1150» уехало на 1138 после уборки мёртвого блока).
--   То есть развернуть проект с нуля было нельзя.
--
-- ПОЧЕМУ ИМЕННО ЭТА ВЕРСИЯ, А НЕ СВЕЖАЯ МЕТКА ВРЕМЕНИ.
--   Версия и имя сняты с прода. `supabase db push` сопоставляет файлы с
--   историей ПО ВЕРСИИ: на проде этот файл будет пропущен как уже применённый,
--   а на чистой базе встанет в правильное место — после
--   20260430_003_appointments.sql и задолго до 20260720210001. Свежая метка
--   (например 20260826...) на чистой базе легла бы ПОСЛЕ читателей и цепочку
--   не починила бы, а на проде `db push` отказался бы её брать без
--   --include-all, потому что в истории её нет.
--
-- Типы и дефолты сняты с прода через information_schema.columns — ни одной
-- «попутной» правки, чтобы чистая среда получилась побайтово равной боевой
-- и совпала с packages/shared/src/db/database.types.ts:345-351, где четыре
-- из семи полей объявлены не-nullable.
--
-- Всё идемпотентно (`add column if not exists`): на боевой базе файл проходит
-- вхолостую, даже если его выполнить принудительно.

alter table public.appointments
  add column if not exists event_all_day      boolean     not null default false,
  add column if not exists event_notes        text        not null default ''::text,
  add column if not exists event_url          text        not null default ''::text,
  add column if not exists event_push_enabled boolean     not null default false,
  add column if not exists event_push_offsets jsonb       not null default '[]'::jsonb,
  add column if not exists event_repeat       jsonb       not null default '{"kind": "none"}'::jsonb,
  add column if not exists event_push_at      timestamptz;

comment on column public.appointments.event_all_day is
  'Личное событие занимает весь день — время начала/конца UI игнорирует.';
comment on column public.appointments.event_notes is
  'Заметка личного события. Отдельно от appointments.comment: комментарий '
  'к заявке виден бригаде, заметка события — только автору.';
comment on column public.appointments.event_url is
  'Ссылка личного события (созвон, карточка встречи).';
comment on column public.appointments.event_push_enabled is
  'Напоминать о личном событии пушем.';
comment on column public.appointments.event_push_offsets is
  'Минуты ДО начала события, когда слать пуш: [10, 60]. Своя колонка, '
  'а не reminder_offsets, потому что напоминания заявки уходят КЛИЕНТУ, '
  'а эти — автору события.';
comment on column public.appointments.event_repeat is
  'Повтор события: {"kind":"none"|"daily"|"weekly"|"monthly"|"yearly", ...}. '
  'Всегда объект, поэтому not null default {"kind":"none"} — читатели '
  '(list_master_appointments_safe) не проверяют на null.';
comment on column public.appointments.event_push_at is
  'Момент ближайшего запланированного пуша. Считает сервер, клиент шлёт null.';
