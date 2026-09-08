-- Тип события: «скрыт» и «удалён» — разные состояния (владелец 2026-09-08:
-- «свайп вправо — удалить, влево — скрыть», как в услугах и метках).
--
-- До сих пор у типа был только `is_active`, и им же кодировалось удаление:
-- «удалить» гасило флаг, а список фильтровал по нему. Скрытия в продукте не
-- существовало вовсе. Экрану справочника нужны оба: скрытый тип остаётся на
-- экране серой строкой и возвращается одним касанием, удалённый уходит из
-- выбора совсем. Двум состояниям — две колонки, ровно как у `public.cities`.

alter table public.personal_event_types
  add column if not exists deleted_at timestamptz;

create index if not exists personal_event_types_deleted_at_idx
  on public.personal_event_types (tenant_id, deleted_at)
  where deleted_at is null;

-- Прежние погашенные строки — это именно удаления, а не скрытия: помечаем их
-- так, иначе новый экран предложил бы «показать» то, что человек удалил.
update public.personal_event_types
   set deleted_at = coalesce(deleted_at, updated_at)
 where is_active = false
   and deleted_at is null;
