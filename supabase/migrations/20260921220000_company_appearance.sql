-- КОМПАНИЯ УЧИТСЯ НОСИТЬ ВИД (цвет и значок).
--
-- Владелец 21.09, глядя на карточку реквизитов в выгруженной дизайн-системе:
-- «название компании вот тут неправильно указано — у нас должно быть слева
-- цвет иконкой и название компании, и внизу то же самое; всё в одном стиле
-- сделай». «В одном стиле» — это анатомия справочников продукта: плитка вида
-- слева, имя рядом, одна шторка на цвет и значок (`NameColorField` +
-- `AppearanceSheet`), а строка списка — карточка с той же плиткой слева.
--
-- До сих пор у набора реквизитов не было НИ ЦВЕТА, НИ ЗНАЧКА, поэтому и в
-- списке, и в шторке выбора все наборы выглядели одинаково: один и тот же
-- значок «здание», один и тот же акцентный цвет. У кого две фирмы (а это
-- ровно тот человек, ради которого наборов несколько), различать их было
-- нечем, кроме чтения имени.
--
-- Колонки те же, что у типов объекта, категорий и меток: `color` — «#RRGGBB»,
-- `icon` — имя из нашего набора значков. Пусто — вида нет, и плитка рисуется
-- серой заглушкой, как у любой сущности без вида.

begin;

set local lock_timeout = '5s';

-- БЕЗ `default`: `add column … default` вычисляется ОДИН раз и прошивает
-- значение во все прошлые строки — «вид, который никто не выбирал», у всех
-- девятнадцати арендаторов разом.
alter table public.companies
  add column if not exists color text;

alter table public.companies
  add column if not exists icon text;

-- Формат сторожит база, а не только форма: цвет и значок приезжают прямой
-- записью из клиента (RPC у реквизитов нет), и «синий» или `<script>` в
-- колонке цвета — это мусор на чеке, а не ошибка ввода.
alter table public.companies drop constraint if exists companies_color_format;
alter table public.companies
  add constraint companies_color_format
  check (color is null or color ~ '^#[0-9A-Fa-f]{6}$');

alter table public.companies drop constraint if exists companies_icon_format;
alter table public.companies
  add constraint companies_icon_format
  check (icon is null or icon ~ '^[a-z0-9-]{1,40}$');

comment on column public.companies.color is
  'Цвет набора реквизитов «#RRGGBB». Пусто — вида нет, плитка серая.';
comment on column public.companies.icon is
  'Значок набора реквизитов, имя из набора приложения. Пусто — вида нет.';

-- Сторож наката: колонки существуют, формат держится, и ни одной прошитой
-- строки (`atthasmissing` — след `add column … default`).
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'companies' and column_name = 'color'
  ) or not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'companies' and column_name = 'icon'
  ) then
    raise exception 'companies did not get its appearance columns';
  end if;

  if exists (
    select 1 from pg_attribute
     where attrelid = 'public.companies'::regclass
       and attname in ('color', 'icon')
       and atthasmissing
  ) then
    raise exception 'appearance columns stamped existing rows — they must stay null';
  end if;
end
$$;

commit;
