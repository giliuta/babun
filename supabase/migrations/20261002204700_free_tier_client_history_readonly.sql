-- БЕЗ ТАРИФА КЛИЕНТСКАЯ ИСТОРИЯ — ТОЛЬКО ДЛЯ ПРОСМОТРА (владелец 02.10).
--
-- «Раньше создавал записи — могу надавать наперёд записи, а потом туда
-- добавлять новых клиентов или тех, что были… люди один раз оплатят или даже
-- 14 дней бесплатно насоздают кучу клиентов, потом будут переносить и
-- постоянно добавлять в базу». Миграция 20261001183700 закрывала без тарифа
-- только СОЗДАНИЕ клиента и записи клиента. Правка уже заведённого шла
-- мимо: в старую запись можно было поставить любого клиента, перенести её,
-- переписать карточку клиента.
--
-- Теперь, пока у аккаунта нет тарифа:
--   • запись клиента (`kind = 'work'`) не правится вовсе — ни клиент, ни
--     время, ни оплата; событие в запись клиента не превращается;
--   • карточка клиента не правится; убрать клиента в архив можно — это не
--     добавляет базе ничего;
--   • файлы клиента и его теги не добавляются и не меняются.
-- Удалять своё можно, как и раньше (там свои сторожа истории). Сервер, cron
-- и вебхуки (без входа) не задеты. Партнёров на таком аккаунте и так держит
-- `tenant_partner_writes_guard`.

create or replace function public.tenant_free_readonly_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null
     or public.tenant_effective_plan(new.tenant_id) is distinct from 'free' then
    return new;
  end if;

  if tg_table_name = 'appointments' then
    if new.kind = 'work' or (tg_op = 'UPDATE' and old.kind = 'work') then
      raise exception 'Записи клиентов без тарифа — только для просмотра'
        using errcode = 'P0001', hint = 'plan:book-clients';
    end if;
    return new;
  end if;

  if tg_table_name = 'clients' then
    -- Архив — можно: он ничего не добавляет базе.
    if tg_op = 'UPDATE'
       and (to_jsonb(new) - 'deleted_at' - 'purge_at' - 'updated_at')
         = (to_jsonb(old) - 'deleted_at' - 'purge_at' - 'updated_at') then
      return new;
    end if;
    raise exception 'Клиенты без тарифа — только для просмотра'
      using errcode = 'P0001', hint = 'plan:clients';
  end if;

  -- Файлы и теги клиента.
  raise exception 'Клиенты без тарифа — только для просмотра'
    using errcode = 'P0001', hint = 'plan:clients';
end;
$function$;

revoke execute on function public.tenant_free_readonly_guard() from public, anon;

drop trigger if exists appointments_free_readonly on public.appointments;
create trigger appointments_free_readonly
  before update on public.appointments
  for each row execute function public.tenant_free_readonly_guard();

drop trigger if exists clients_free_readonly on public.clients;
create trigger clients_free_readonly
  before update on public.clients
  for each row execute function public.tenant_free_readonly_guard();

drop trigger if exists client_attachments_free_readonly on public.client_attachments;
create trigger client_attachments_free_readonly
  before insert or update on public.client_attachments
  for each row execute function public.tenant_free_readonly_guard();

drop trigger if exists client_tag_assignments_free_readonly on public.client_tag_assignments;
create trigger client_tag_assignments_free_readonly
  before insert or update on public.client_tag_assignments
  for each row execute function public.tenant_free_readonly_guard();
