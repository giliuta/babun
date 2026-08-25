-- УСЛУГА ПОЛУЧАЕТ ТИП: «КОЛИЧЕСТВО» ИЛИ «ВАРИАНТЫ» (спека владельца v4).
--
-- Тест на тип: имеет ли смысл вопрос «сколько стоит одна штука». Кондиционер —
-- да, €45. Комната в трёхкомнатной — нет: трёхкомнатная это НЕ «три раза
-- комната», и семикомнатная не выводится экстраполяцией. Первое — `quantity`,
-- второе — `variant`, и между ними нет математической связи.
--
-- ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ (сверено с базой перед написанием):
--   • `unit_type`/`unit_label` — единица уже живёт колонкой `unit` (text) с
--     2026-08-25 и доезжает до строки счёта. Второй колонки для того же не
--     заводим.
--   • `pricing_mode` — есть `price_entry ('total' | 'unit')`. Здесь он только
--     обретает ВТОРОЙ смысл: см. ниже.
--   • `is_archived` — есть `is_active`, на нём стоит мягкое удаление и дверь
--     «Убранные».
--   • `sort_order` — есть `position` с перетаскиванием.
--   • `tenants.currency`, `vat_rate`, `vat_mode` — уже есть, НДС живёт целой
--     системой с тремя клавишами на операции.
--
-- КОНВЕРТАЦИЯ ЦЕН ИЗ СПЕКИ НЕ ДЕЛАЕТСЯ. Спека предполагает, что `price_tiers`
-- хранит АБСОЛЮТНЫЕ ИТОГИ («€100 = 2×€50»), и предлагает поделить их на
-- `from_qty`. В базе они хранятся ЗА ОДНУ уже сейчас:
--   A/C Cleaning → [{min_qty:2, price_per_unit:50}, {min_qty:3, price_per_unit:45}]
-- «€100» человек видел на экране, потому что показ умножает на количество —
-- это линза `price_entry`, заведённая 2026-08-25. Деление на `from_qty`
-- превратило бы €50/шт в €25/шт и €45/шт в €15/шт, то есть уронило бы прайс
-- втрое. Ни одной строки не трогаем.
alter table public.services
  add column if not exists service_type text not null default 'quantity';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'services_service_type_check'
  ) then
    alter table public.services
      add constraint services_service_type_check
      check (service_type in ('quantity', 'variant'));
  end if;
end $$;

-- ВРЕМЯ ВОКРУГ РАБОТЫ. Слот в календаре = дорога + работа + уборка за собой.
-- Без буферов бригада перегружена на бумаге: сетка показывает свободное время,
-- которого нет, потому что в нём едут.
alter table public.services
  add column if not exists buffer_before_min int not null default 0;
alter table public.services
  add column if not exists buffer_after_min int not null default 0;
alter table public.services
  add column if not exists required_staff int not null default 1;

-- ПРАВИЛО ЗА ПОСЛЕДНИМ ПОРОГОМ. Сегодня цена за пределами лестницы берёт
-- последнюю ступень, а время тянется наклоном — то есть за семь штук продукт
-- называет числа, которых никто не вводил. Явное правило «свыше N: +€X, +M мин»
-- заменяет обе догадки.
alter table public.services
  add column if not exists overflow_price numeric;
alter table public.services
  add column if not exists overflow_duration_min int;

alter table public.services
  add column if not exists min_qty numeric not null default 1;
alter table public.services
  add column if not exists max_qty numeric;

-- Мягкая связь для отчётов: услуга скопирована из другой команды. Интерфейс её
-- не показывает; она позволяет склеить «A/C Cleaning» по всем командам, не
-- полагаясь на совпадение названий.
-- ССЫЛКА СОСТАВНАЯ, по (tenant_id, id): первичный ключ услуги составной, и
-- ссылка по одному id пустила бы услугу одного тенанта к услуге другого.
alter table public.services
  add column if not exists copied_from_service_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'services_copied_from_fk'
  ) then
    alter table public.services
      add constraint services_copied_from_fk
      foreign key (tenant_id, copied_from_service_id)
      references public.services(tenant_id, id)
      on delete set null;
  end if;
end $$;

-- ВАРИАНТЫ. Плоский список без математики: название, цена, длительность.
create table if not exists public.service_variants (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  service_id text not null,
  name text not null,
  price numeric not null default 0,
  duration_min int not null default 60,
  cost numeric not null default 0,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Составная ссылка на услугу — по её составному ключу. Каскад: варианты
  -- живут только вместе со своей услугой, отдельно они бессмысленны.
  constraint service_variants_service_fk
    foreign key (tenant_id, service_id)
    references public.services(tenant_id, id)
    on delete cascade
);

create index if not exists idx_service_variants_service
  on public.service_variants(tenant_id, service_id, position);

alter table public.service_variants enable row level security;

-- RLS — ДОСЛОВНО ТА ЖЕ ПОЛИТИКА, ЧТО У `services`. Варианты это цены, а цены
-- в этом продукте видит и правит только владелец; мастеру и диспетчеру они
-- приезжают проекциями. Отдельная политика «помягче» здесь была бы дырой.
drop policy if exists service_variants_select_owner on public.service_variants;
create policy service_variants_select_owner on public.service_variants
  for select
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  );

drop policy if exists service_variants_write_owner on public.service_variants;
create policy service_variants_write_owner on public.service_variants
  for all
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  );

drop trigger if exists service_variants_set_updated_at on public.service_variants;
create trigger service_variants_set_updated_at
  before update on public.service_variants
  for each row execute function public.set_updated_at();
