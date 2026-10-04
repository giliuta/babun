-- ОДНО МЕСТО ДЛЯ БУМАГ ПАРТНЁРА (04.10). `master_documents` — наследство
-- веба (20260517_003): ни одного обращения из приложения, в боевой базе ноль
-- строк. Бумаги партнёра теперь живут в `partner_files` (20261004193517) —
-- блок «Файлы» на его странице. Две таблицы под одно и то же разошлись бы на
-- первом же правиле доступа, поэтому старая уходит. Пустоту проверяет сторож:
-- со строками миграция не пройдёт.

set local lock_timeout = '5s';

do $guard$
begin
  if exists (select 1 from public.master_documents) then
    raise exception 'сторож: в master_documents есть строки — переносить, а не удалять';
  end if;
end
$guard$;

drop table public.master_documents;
