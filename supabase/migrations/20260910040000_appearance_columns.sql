-- ВИД СУЩНОСТИ — ЦВЕТ И ЗНАЧОК ТАМ, ГДЕ ИХ НЕ БЫЛО (владелец 2026-09-10:
-- «надо продумать там, где его нет, чтобы его добавить… нету у нас это в дом,
-- нету в квартиру, вилла — давай лучше везде это делать»).
--
-- Счёт, категория финансов и тип события уже носят и цвет, и значок. Услуга,
-- команда и тег клиента носили только цвет, а тип объекта («Дом», «Квартира»,
-- «Офис») — вообще ничего: в списке он был серой строкой, тогда как соседний
-- справочник в том же кабинете рисовался цветной плиткой.
--
-- Колонки НЕОБЯЗАТЕЛЬНЫЕ и без умолчаний: пустой цвет означает «не красить»
-- (так же, как у тега и счёта), пустой значок — «нарисовать глиф вида».
-- Данных это не трогает, поэтому миграция идёт до клиентского кода.

alter table public.location_labels add column if not exists color text;
alter table public.location_labels add column if not exists icon text;

alter table public.client_tags add column if not exists icon text;
alter table public.services add column if not exists icon text;
alter table public.teams add column if not exists icon text;

comment on column public.location_labels.color is 'Цвет типа объекта из общей палитры (PRESET_COLORS). NULL — не красить.';
comment on column public.location_labels.icon is 'Слаг значка из общего словаря (ICON_PRESETS). NULL — глиф вида.';
comment on column public.client_tags.icon is 'Слаг значка из общего словаря (ICON_PRESETS). NULL — глиф вида.';
comment on column public.services.icon is 'Слаг значка из общего словаря (ICON_PRESETS). NULL — глиф вида.';
comment on column public.teams.icon is 'Слаг значка из общего словаря (ICON_PRESETS). NULL — глиф вида.';
