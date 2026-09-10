-- ТЕГ ЖИВЁТ ПО ТЕМ ЖЕ ЗАКОНАМ, ЧТО ОСТАЛЬНЫЕ СПРАВОЧНИКИ (владелец 2026-09-10:
-- «везде должна быть единая архитектура… справа шесть точек, чтоб можно было
-- двигать; свайп влево — справа появляется „Удалить“; свайп вправо — слева
-- „Скрыть“; и везде во всех одно и то же»).
--
-- У `client_tags` не было ни порядка, ни скрытия: экран честно писал в
-- комментарии, что перетаскивания нет, потому что колонки порядка нет, а
-- заводить её — решение владельца с миграцией на боевую базу. Решение принято.
--
-- `position` заполняется по текущему видимому порядку (по имени), чтобы после
-- миграции список не перетасовался под рукой. `hidden` — обычный флаг строки:
-- скрытая гаснет, падает в конец и исчезает из шторки выбора, но остаётся у
-- клиентов, которым уже проставлена.

alter table public.client_tags
  add column if not exists position integer not null default 0;
alter table public.client_tags
  add column if not exists hidden boolean not null default false;

update public.client_tags t
   set position = ordered.rn
  from (
    select id, tenant_id,
           (row_number() over (partition by tenant_id order by name, id) - 1) as rn
      from public.client_tags
  ) ordered
 where ordered.id = t.id
   and ordered.tenant_id = t.tenant_id
   and t.position = 0;

comment on column public.client_tags.position is 'Порядок в справочнике: перетаскивание ручкой, как у типов объектов и меток.';
comment on column public.client_tags.hidden is 'Скрытый тег: гаснет, уходит в конец списка и не предлагается в выборе.';
