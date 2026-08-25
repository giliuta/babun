-- ДОГОН ДРЕЙФА: у client_attachments не было половины обещанных ограничений.
--
-- ЧТО СЛУЧИЛОСЬ. Таблицу завёл 20260517_008_client_attachments.sql. Через два
-- месяца 20260720210003_master_privacy_hardening.sql написал ВТОРОЙ
-- `create table if not exists` — с другим определением: unique на storage_path,
-- check на size_bytes, FK и default auth.uid() у created_by. Второе создание
-- молча ничего не делало (таблица уже есть), но читалось как истина. В итоге
-- файл описывал схему, которой нет ни на одной базе.
--
-- Мёртвый блок из 20260720210003 удалён, а обещанные им ограничения заводятся
-- здесь — по-настоящему.
--
-- ПОЧЕМУ СНАЧАЛА ЧИСТКА, А ПОТОМ ОГРАНИЧЕНИЯ. Unique-индекс и FK Postgres
-- проверяет по ВСЕМ существующим строкам в момент создания. Один дубль пути или
-- один created_by удалённого сотрудника — и файл падает посреди наката, унося с
-- собой всю транзакцию миграции. На чистой базе таблица пуста и падать нечему,
-- на проде она почти пуста — но «почти» это не «точно», а миграция обязана
-- проходить на любых данных. Поэтому каждое ограничение идёт парой:
-- нормализация данных под него, затем создание.
--
-- ЧТО ПРОИСХОДИТ С СУЩЕСТВУЮЩИМИ СТРОКАМИ (три правки, все обратимы по смыслу,
-- ни одна не трогает сами файлы в бакете):
--   1. дубли по storage_path — остаётся САМАЯ РАННЯЯ строка, остальные строки
--      метаданных удаляются. Файл в бакете один и тот же, ссылка на него
--      сохраняется; исчезает только повтор в списке вложений карточки;
--   2. created_by, указывающий на несуществующего пользователя, становится
--      null — ровно то, что сделал бы `on delete set null`, если бы FK стоял с
--      самого начала;
--   3. отрицательный size_bytes (по схеме bigint, физически невозможен —
--      только порча) обнуляется. Ноль уже является дефолтом колонки.
--
-- ЧЕГО ЗДЕСЬ НАМЕРЕННО НЕТ.
--   * `mime_type set default 'application/octet-stream'` — дефолт остаётся
--     пустой строкой, как в 20260517_008 и как на проде. Приложение
--     (apps/mobile/src/features/clients/card-attachments.ts) всегда шлёт
--     mime_type явно, так что дефолт никого не спасает, а менять его — значит
--     разводить прод и репо ещё раз, теперь в другую сторону.
--   * `create unique index concurrently` — Supabase гоняет каждый файл
--     миграции в транзакции, CONCURRENTLY там падает. Таблица маленькая
--     (вложения клиентов, единицы строк на тенанта), короткая блокировка на
--     построение индекса ничего не стоит.

-- 1. ДУБЛИ ПУТИ. Путь строится как {tenant}/{client}/{uuid}.{ext}, поэтому
--    дублей быть не должно — но ретрай аплоада мог оставить вторую строку
--    метаданных на тот же файл, и защищаемся мы именно от него. Оставляем самую
--    раннюю запись: она та, на которую уже могли сослаться.
delete from public.client_attachments dup
 using public.client_attachments keep
 where dup.storage_path = keep.storage_path
   and (keep.created_at, keep.id) < (dup.created_at, dup.id);

-- 2. АВТОР, КОТОРОГО БОЛЬШЕ НЕТ. FK ниже ставится как `on delete set null`;
--    строки, осиротевшие ДО его появления, приводим к тому же виду руками.
update public.client_attachments a
   set created_by = null
 where a.created_by is not null
   and not exists (select 1 from auth.users u where u.id = a.created_by);

-- 3. ОТРИЦАТЕЛЬНЫЙ РАЗМЕР. Значение не из жизни, а из порчи; check ниже такую
--    строку не пропустит, поэтому чиним до него.
update public.client_attachments
   set size_bytes = 0
 where size_bytes < 0;

do $$
begin
  -- Один файл в бакете — одна строка метаданных. После шага 1 дублей нет, но
  -- индекс всё равно заводим под проверкой: если строку успели вставить между
  -- чисткой и этим местом, миграция должна ЖАЛОВАТЬСЯ, а не падать посреди
  -- наката и откатывать всё остальное.
  if exists (
    select 1
      from public.client_attachments
     group by storage_path
    having count(*) > 1
  ) then
    -- RAISE берёт формат одним литералом, поэтому длинный текст собираем
    -- выражением через '%', а не переносом строки.
    raise warning '%', 'client_attachments: остались дубли storage_path — '
      || 'client_attachments_storage_path_key НЕ создан, разобрать вручную';
  else
    execute 'create unique index if not exists '
      || 'client_attachments_storage_path_key '
      || 'on public.client_attachments(storage_path)';
  end if;

  -- Автор вложения проставляется сервером: клиент created_by не шлёт вовсе,
  -- а политика вставки (20260720210003) допускает только null или auth.uid().
  alter table public.client_attachments
    alter column created_by set default auth.uid();

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.client_attachments'::regclass
       and conname = 'client_attachments_created_by_fkey'
  ) then
    if exists (
      select 1
        from public.client_attachments a
       where a.created_by is not null
         and not exists (select 1 from auth.users u where u.id = a.created_by)
    ) then
      raise warning '%', 'client_attachments: created_by ссылается на '
        || 'удалённых пользователей — '
        || 'client_attachments_created_by_fkey НЕ создан';
    else
      -- set null, а не cascade: удалённый сотрудник не должен уносить файлы
      -- клиента вместе с собой.
      alter table public.client_attachments
        add constraint client_attachments_created_by_fkey
        foreign key (created_by) references auth.users(id) on delete set null;
    end if;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.client_attachments'::regclass
       and conname = 'client_attachments_size_nonneg'
  ) then
    if exists (select 1 from public.client_attachments where size_bytes < 0) then
      raise warning '%', 'client_attachments: остались отрицательные '
        || 'size_bytes — client_attachments_size_nonneg НЕ создан';
    else
      alter table public.client_attachments
        add constraint client_attachments_size_nonneg check (size_bytes >= 0);
    end if;
  end if;
end;
$$;
