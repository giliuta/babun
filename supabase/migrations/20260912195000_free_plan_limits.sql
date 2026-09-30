-- Бесплатный уровень: личный календарь есть, работа с клиентами — нет.
--
-- Владелец 2026-09-12: «самое главное — новому человеку личный календарь и
-- личные финансы; писать туда клиентские записи он не может, а если покупает
-- план — тогда уже тариф».
--
-- ЧТО ОТКРЫТО БЕСПЛАТНО: личные события, финансы целиком (счета, категории,
-- доходы, расходы, долги) и своя база контактов. Этого достаточно, чтобы вести
-- свою жизнь и свои деньги, и недостаточно, чтобы обслуживать клиентов.
--
-- ЧТО ЗАКРЫТО: клиентская ЗАПИСЬ (`appointments.kind = 'work'`), услуги,
-- мастера и документы. Граница выбрана не по жадности, а по смыслу: без услуг,
-- записи клиента и счёта сервис не оказывают — значит бесплатный уровень не
-- заменяет платный, а ведёт к нему.
--
-- ПОЧЕМУ ЭТО НА СЕРВЕРЕ, А НЕ НА ЭКРАНЕ. Канон, правило 10: галочка, которую
-- знает только экран, — ложное обещание. Экран спрячет кнопку и объяснит
-- по-человечески, но истина здесь: любой путь (deep link, старая сборка,
-- офлайн-очередь, прямой запрос) упирается в одно и то же место.
--
-- СТАРЫЕ СТРОКИ НЕ ТРОГАЕМ. Триггеры только на INSERT: тот, кто уже завёл
-- услуги и записи, продолжает их видеть и править. Отбирать сделанное за
-- перевод на другой тариф — не ограничение, а подстава.
--
-- РАБОТАЮЩИЕ КОМПАНИИ ЗАЩИЩЕНЫ ПРЕДЫДУЩЕЙ МИГРАЦИЕЙ (grandfather_existing_
-- tenants): у всех, кто прошёл онбординг, стоит plan_override = 'lifetime'.

create or replace function public.enforce_plan_limits()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_plan text;
begin
  if new.tenant_id is null then
    raise exception 'ограничение тарифа требует tenant_id' using errcode = '22023';
  end if;

  v_plan := public.tenant_effective_plan(new.tenant_id);

  -- Платный уровень и ручные выдачи проходят молча. Неизвестный тариф
  -- трактуем как платный: ошибка в данных не должна запирать работу.
  if v_plan is distinct from 'free' then
    return new;
  end if;

  if tg_table_name = 'appointments' then
    -- Личное событие бесплатно и остаётся бесплатным. Закрыта ровно работа.
    if new.kind = 'work' then
      raise exception 'Записывать клиентов в этом тарифе нельзя'
        using errcode = 'P0001', hint = 'plan:book-clients';
    end if;
    return new;
  end if;

  if tg_table_name = 'services' then
    raise exception 'Услуги доступны в платном тарифе'
      using errcode = 'P0001', hint = 'plan:services';
  end if;

  if tg_table_name = 'masters' then
    raise exception 'Мастера доступны в платном тарифе'
      using errcode = 'P0001', hint = 'plan:masters';
  end if;

  if tg_table_name = 'invoices' then
    raise exception 'Документы доступны в платном тарифе'
      using errcode = 'P0001', hint = 'plan:documents';
  end if;

  return new;
end;
$function$;

revoke all on function public.enforce_plan_limits() from public, anon, authenticated;

drop trigger if exists appointments_enforce_plan on public.appointments;
create trigger appointments_enforce_plan
  before insert on public.appointments
  for each row execute function public.enforce_plan_limits();

drop trigger if exists services_enforce_plan on public.services;
create trigger services_enforce_plan
  before insert on public.services
  for each row execute function public.enforce_plan_limits();

drop trigger if exists masters_enforce_plan on public.masters;
create trigger masters_enforce_plan
  before insert on public.masters
  for each row execute function public.enforce_plan_limits();

drop trigger if exists invoices_enforce_plan on public.invoices;
create trigger invoices_enforce_plan
  before insert on public.invoices
  for each row execute function public.enforce_plan_limits();

do $$
declare
  v_missing text;
begin
  select string_agg(x.t, ', ')
    into v_missing
    from (values ('appointments'), ('services'), ('masters'), ('invoices')) as x(t)
   where not exists (
     select 1 from pg_trigger tg
       join pg_class c on c.oid = tg.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = x.t
        and tg.tgname = x.t || '_enforce_plan'
   );
  if v_missing is not null then
    raise exception 'тариф: сторож не встал на таблицах — %', v_missing;
  end if;

  -- Ни одна работающая компания не должна оказаться под ограничением.
  if exists (
    select 1 from public.tenants
     where onboarded_at is not null
       and public.tenant_effective_plan(id) = 'free'
  ) then
    raise exception 'тариф: работающая компания осталась на бесплатном уровне';
  end if;
end $$;
