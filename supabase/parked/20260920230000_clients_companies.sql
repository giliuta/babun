-- КОМПАНИЯ — ЭТО ТОЖЕ КЛИЕНТ.
--
-- Владелец 2026-09-20, своими словами: «нам звонит Ольга, это её личный
-- телефон, но обслуживаем мы компанию — мы лично Ольгу, её дом, не
-- обслуживаем. Ольга привязана к этой компании. Инвойс выставляется на
-- компанию, Ольга в нём фигурировать не может». И отдельно: «не делать
-- отдельный раздел для компаний, просто привязать компанию к клиенту», и
-- «чтоб не мешало — физиков всё равно больше, чем компаний».
--
-- ПОЧЕМУ НЕ ПОЛЯ ПРЯМО В КАРТОЧКЕ ОЛЬГИ. Завтра из той же компании позвонит
-- второй человек, и те же реквизиты лягут во вторую карточку. Поменяется
-- адрес — поправят в одной, забудут в другой, и два инвойса уйдут с разными
-- адресами. А долг повиснет на том, кто звонил, вместо компании. Поэтому
-- юрлицо живёт ОДНОЙ строкой, а люди на неё ссылаются.
--
-- ПОЧЕМУ НЕ ОТДЕЛЬНАЯ ТАБЛИЦА. Компания и человек отвечают на один и тот же
-- вопрос продукта — «кому мы возим работу и кто платит». У них общий список,
-- общий поиск, общие объекты, общий долг, общая история. Разведи их на две
-- таблицы — и каждый экран клиентов придётся писать дважды, а в записи
-- появится вопрос «а это человек или компания», которого у владельца нет.
--
-- ЭТО НЕ ПУТАТЬ С `public.companies` (20260920200000). Та — реквизиты
-- ПРОДАВЦА, «от кого» документ. Эта — получатель, «для кого». Слово одно,
-- стороны бумаги разные.

-- `add column` берёт AccessExclusiveLock на `clients`, а по таблице идёт живой
-- трафик приложения: в сухом прогоне поймали `40P01 deadlock`. Лучше честно
-- отказаться и повторить в тихую минуту, чем держать таблицу.
set local lock_timeout = '5s';

alter table public.clients
  -- 'person' всем существующим строкам — ровно то, чем они и были. Значение
  -- КОНСТАНТА, а не вычисление на момент наката (урок `add column … default`
  -- 2026-09-19 был про `default auth.uid()`).
  add column if not exists kind text not null default 'person',
  add column if not exists legal_name text,
  add column if not exists business_address text,
  add column if not exists vat_number text,
  add column if not exists reg_number text,
  -- ЧЬЯ РАБОТА. У человека — компания, которую он представляет; у компании
  -- пусто. `on delete set null`: удалили юрлицо — человек остаётся клиентом,
  -- а не исчезает вместе с ним.
  add column if not exists company_id uuid references public.clients(id) on delete set null;

comment on column public.clients.kind is
  'person | company. Компания — такой же клиент: тот же список, поиск, объекты '
  'и долг. Отдельной сущности у неё нет (владелец 2026-09-20).';
comment on column public.clients.company_id is
  'Кого представляет человек. Инвойс и деньги идут на компанию, человек '
  'остаётся тем, кому звонить.';

alter table public.clients drop constraint if exists clients_kind_check;
alter table public.clients
  add constraint clients_kind_check check (kind in ('person', 'company'));

-- САМ НА СЕБЯ НЕ ССЫЛАЕТСЯ. На большинстве путей первым отвечает триггер
-- («Компания не найдена» / «только компанию»), и это нормально: ограничитель
-- здесь — последняя сетка на случай прямой правки в базе мимо триггера.
alter table public.clients drop constraint if exists clients_company_not_self;
alter table public.clients
  add constraint clients_company_not_self check (company_id is distinct from id);

-- У КОМПАНИИ НЕТ СВОЕЙ КОМПАНИИ: иначе завелась бы цепочка, и «кому платить»
-- перестало бы иметь один ответ.
alter table public.clients drop constraint if exists clients_company_only_for_person;
alter table public.clients
  add constraint clients_company_only_for_person
  check (kind = 'person' or company_id is null);

create index if not exists clients_company_idx
  on public.clients (tenant_id, company_id) where company_id is not null;

-- ─── ССЫЛКА ПРОВЕРЯЕТСЯ, А НЕ ПРИНИМАЕТСЯ НА ВЕРУ ───────────────────────
-- Внешний ключ говорит «такая строка есть», но не говорит ни «она твоей
-- компании», ни «она юрлицо». Без этого человека можно было бы закрепить за
-- клиентом ЧУЖОГО тенанта — id пришёл бы с устройства, а RLS на `update`
-- смотрит на правимую строку, а не на ту, куда она ссылается.
create or replace function public.assert_client_company()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  target public.clients%rowtype;
  followers integer;
begin
  -- КОМПАНИЮ, ЗА КОТОРОЙ УЖЕ ЗАКРЕПЛЕНЫ ЛЮДИ, НЕЛЬЗЯ РАЗЖАЛОВАТЬ В ЧЕЛОВЕКА.
  -- Сухой прогон нашёл обход: у самой строки ограничители молчат (её
  -- `company_id` пуст), а у ссылающихся триггер на этом шаге не срабатывает —
  -- и получалось ровно то, что сторож запрещает, человек за человеком. Пока
  -- `kind` не пускают из приложения, дыра спит; откроется вместе с дверью.
  if tg_op = 'UPDATE' and old.kind = 'company' and new.kind <> 'company' then
    select count(*) into followers
      from public.clients where company_id = new.id;
    if followers > 0 then
      raise exception 'За этой компанией закреплено людей: %. Сначала открепите их', followers;
    end if;
  end if;

  if new.company_id is null then
    return new;
  end if;
  select * into target from public.clients where id = new.company_id;
  if not found or target.tenant_id <> new.tenant_id then
    raise exception 'Компания не найдена';
  end if;
  if target.kind <> 'company' then
    raise exception 'Закрепить можно только компанию, а не человека';
  end if;
  return new;
end;
$$;

revoke all on function public.assert_client_company() from public, anon, authenticated;

drop trigger if exists clients_assert_company on public.clients;
create trigger clients_assert_company
  before insert or update of company_id, tenant_id, kind on public.clients
  for each row execute function public.assert_client_company();

-- ─── Проверки после наката ──────────────────────────────────────────────
do $audit$
declare
  person_count integer;
  total integer;
  sample_tenant uuid;
  person_id uuid;
  company_id_var uuid;
begin
  select count(*) into total from public.clients;
  select count(*) into person_count from public.clients where kind = 'person';
  if total <> person_count then
    raise exception 'clients: не все прежние клиенты остались людьми (% из %)',
      person_count, total;
  end if;
  if exists (select 1 from public.clients where company_id is not null) then
    raise exception 'clients: кому-то прописали компанию, которой он не знал';
  end if;

  -- ПРОВЕРЯЕМ САМ ТРИГГЕР, А НЕ ЕГО НАЛИЧИЕ. Сторож, который не пробовали
  -- сломать, ничего не сторожит.
  select tenant_id into sample_tenant from public.clients limit 1;
  if sample_tenant is null then
    raise notice 'clients: клиентов нет, проверку связи пропускаем';
  else
    insert into public.clients (tenant_id, full_name, kind)
      values (sample_tenant, '__проверка компании__', 'company')
      returning id into company_id_var;
    insert into public.clients (tenant_id, full_name, kind, company_id)
      values (sample_tenant, '__проверка человека__', 'person', company_id_var)
      returning id into person_id;

    -- ВЕТКА ТРИГГЕРА «ЭТО НЕ ЮРЛИЦО». Проверяем именно её, а не ограничитель
    -- «у компании нет своей компании»: закрепляем за ЧЕЛОВЕКОМ другого
    -- ЧЕЛОВЕКА — ограничители тут молчат, отказать обязан триггер.
    declare
      second_person uuid;
      failed boolean := false;
    begin
      insert into public.clients (tenant_id, full_name, kind)
        values (sample_tenant, '__проверка второго__', 'person')
        returning id into second_person;
      begin
        update public.clients set company_id = second_person where id = person_id;
      exception when others then
        failed := true;
        if sqlerrm not like '%только компанию%' then
          raise exception 'clients: триггер отказал не тем: %', sqlerrm;
        end if;
      end;
      if not failed then
        raise exception 'clients: за человеком дали закрепить человека — сторож молчит';
      end if;
      delete from public.clients where id = second_person;
    end;

    -- И ВТОРАЯ ВЕТКА: чужой тенант. Подсовываем клиента другой компании —
    -- внешний ключ его пропустит, отказать обязан триггер.
    declare
      alien uuid;
      failed_alien boolean := false;
    begin
      select id into alien from public.clients
       where tenant_id <> sample_tenant and kind = 'company' limit 1;
      if alien is null then
        insert into public.clients (tenant_id, full_name, kind)
        select tenant_id, '__чужая компания__', 'company'
          from public.clients where tenant_id <> sample_tenant limit 1
        returning id into alien;
      end if;
      if alien is not null then
        begin
          update public.clients set company_id = alien where id = person_id;
        exception when others then
          failed_alien := true;
          if sqlerrm not like '%не найдена%' then
            raise exception 'clients: чужая компания отказала не тем: %', sqlerrm;
          end if;
        end;
        if not failed_alien then
          raise exception 'clients: дали закрепить компанию ЧУЖОГО тенанта';
        end if;
        -- Уборка строго в ТОМ тенанте, куда клали: `delete` по одному имени
        -- шёл бы по всей базе (сухой прогон 2026-09-20).
        delete from public.clients
         where full_name = '__чужая компания__' and id = alien;
      end if;
    end;

    -- ТРЕТЬЯ ВЕТКА: компанию с закреплёнными людьми нельзя разжаловать.
    declare
      failed_demote boolean := false;
    begin
      begin
        update public.clients set kind = 'person' where id = company_id_var;
      exception when others then
        failed_demote := true;
        if sqlerrm not like '%закреплено людей%' then
          raise exception 'clients: разжалование отказало не тем: %', sqlerrm;
        end if;
      end;
      if not failed_demote then
        raise exception 'clients: компанию с людьми дали разжаловать — ссылки повисли бы';
      end if;
    end;

    delete from public.clients where id in (person_id, company_id_var);
  end if;

  if not exists (
    select 1 from pg_trigger where tgname = 'clients_assert_company' and not tgisinternal
  ) then
    raise exception 'clients: сторож связи не поставлен';
  end if;
end;
$audit$;
