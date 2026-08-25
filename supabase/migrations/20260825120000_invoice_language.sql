-- СЧЁТ ГОВОРИТ НА ЯЗЫКЕ КЛИЕНТА, А НЕ НА ЯЗЫКЕ ПРИЛОЖЕНИЯ.
--
-- Владелец 2026-08-25: «мне нужен инвойс на английском». Кипр — местные и
-- иностранные клиенты вперемешку, и бумага уходит и тем, и другим. Само
-- приложение остаётся русским: переключается только документ.
--
-- ЯЗЫК ЛЕЖИТ У ДОКУМЕНТА, А НЕ У КОМПАНИИ, потому что выставленный счёт
-- ЗАМОРОЖЕН целиком — как и снимки сторон, и единица в строке. Один клиент
-- получает счёт по-английски, следующий по-русски, и вчерашняя бумага не
-- переписывается от того, что сегодня переключили настройку.
alter table public.invoices
  add column if not exists language text not null default 'ru';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'invoices_language_check'
  ) then
    alter table public.invoices
      add constraint invoices_language_check check (language in ('ru', 'en'));
  end if;
end $$;
