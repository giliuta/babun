-- ПРАВА ПАРТНЁРОВ: ЧЕТЫРЕ КРАЯ, ГДЕ СЕРВЕР ДЕРЖАЛ МЕНЬШЕ ОБЕЩАННОГО
-- (аудит 035: cab/R-01, cab/R-09, cab/R-10, cab/R-12).
--
-- 1. Файлы карточек партнёров (R-01). Директор («Партнёры: Управляет»)
--    добавлял и удалял файлы ЛЮБОЙ карточки — директоров и свою, хотя
--    карточки он правит только у тех, кого ведёт (`partners_card_manageable`).
--    Теперь файлы — по тому же правилу. Файл в бакете без строки (сирота)
--    стирать можно, как и раньше.
-- 2. Юрлицо нового клиента (R-09). Партнёр с «Реквизиты: Меняет» заводил
--    клиента с юрлицом — сторож молча обнулял `legal_name` на любом INSERT.
--    Теперь обнуляет только без права «Реквизиты: Меняет» в команде клиента.
-- 3. Настройки чужих команд (R-10). Вид формы (`team_design`), метки
--    (`cities`) и типы событий (`personal_event_types`) любой команды
--    аккаунта читал любой участник, ставка VAT (`effective_vat_settings`) —
--    тоже. Теперь не-владелец читает их только у календарей, к которым
--    прикреплён (`member_calendars`); строки без команды — как были.
-- 4. Деньги счёта (R-12). «Счета в настройках: Меняет» обещает «заводит,
--    переименовывает и удаляет счета команды», а UPDATE пускал и
--    начальный остаток с режимом VAT — они меняют баланс и налог, которые
--    видит владелец. Теперь их меняет только владелец; имя, вид, порядок,
--    заметка и удаление — как обещано.

-- 1. Файлы карточек партнёров
alter policy partner_files_insert on public.partner_files
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.access_company('company.partners', 'write'))
    and public.partners_card_manageable(master_id)
  );

alter policy partner_files_delete on public.partner_files
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.access_company('company.partners', 'write'))
    and public.partners_card_manageable(master_id)
  );

alter policy storage_partner_files_insert on storage.objects
  with check (
    bucket_id = 'partner-files'
    and (storage.foldername(name))[1] = ((select public.current_tenant_id()))::text
    and (select public.access_company('company.partners', 'write'))
    and exists (
      select 1 from public.partner_files f
       where f.storage_path = objects.name
         and f.tenant_id = (select public.current_tenant_id())
         and public.partners_card_manageable(f.master_id)
    )
  );

alter policy storage_partner_files_delete on storage.objects
  using (
    bucket_id = 'partner-files'
    and (storage.foldername(name))[1] = ((select public.current_tenant_id()))::text
    and (select public.access_company('company.partners', 'write'))
    and (
      not exists (
        select 1 from public.partner_files f
         where f.storage_path = objects.name
           and f.tenant_id = (select public.current_tenant_id())
      )
      or exists (
        select 1 from public.partner_files f
         where f.storage_path = objects.name
           and f.tenant_id = (select public.current_tenant_id())
           and public.partners_card_manageable(f.master_id)
      )
    )
  );

-- 2. Юрлицо нового клиента
-- Определитель: уровень права (`access_team_level`) закрыт для людей; роль и
-- пользователь всё равно берутся из JWT запроса.
create or replace function public.clients_member_legal_name_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if public.current_user_role() is distinct from 'master' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    -- Юрлицо нового клиента остаётся только у того, кому «Реквизиты»
    -- открыты на запись в команде этого клиента.
    if new.team_id is null
       or public.access_team_level(public.current_tenant_id(), auth.uid(), 'clients.requisites', new.team_id)
          is distinct from 'write' then
      new.legal_name := null;
    end if;
  elsif new.legal_name is distinct from old.legal_name
        -- «Реквизиты» с «Видит и меняет» правят и юрлицо основного набора —
        -- приложение шлёт его вместе с `requisites`.
        and (old.id = any(public.access_block_client_ids('clients.requisites', 'write'))) is not true then
    raise exception 'access:field:legal_name' using errcode = '42501';
  end if;
  return new;
end;
$function$;

revoke all on function public.clients_member_legal_name_guard() from public, anon, authenticated;

-- 3. Настройки чужих команд
alter policy team_design_select on public.team_design
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.current_user_role()) = 'owner'
      or team_id in (
        select mc.team_id from public.member_calendars mc
         where mc.tenant_id = (select public.current_tenant_id()) and mc.user_id = (select auth.uid())
      )
    )
  );

alter policy cities_select_member on public.cities
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_user_role()) is not null
    and (
      (select public.current_user_role()) = 'owner'
      or team_id is null
      or team_id in (
        select mc.team_id from public.member_calendars mc
         where mc.tenant_id = (select public.current_tenant_id()) and mc.user_id = (select auth.uid())
      )
    )
  );

alter policy personal_event_types_select on public.personal_event_types
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_user_role()) is not null
    and (
      (select public.current_user_role()) = 'owner'
      or team_id is null
      or team_id in (
        select mc.team_id from public.member_calendars mc
         where mc.tenant_id = (select public.current_tenant_id()) and mc.user_id = (select auth.uid())
      )
    )
  );

create or replace function public.effective_vat_settings(p_team_id text)
returns table(vat_mode text, vat_rate numeric, vat_exemption_note text)
language sql
stable security definer
set search_path = public
as $function$
  select
    coalesce(s.vat_mode, t.vat_mode) as vat_mode,
    coalesce(s.vat_rate, t.vat_rate) as vat_rate,
    coalesce(s.vat_exemption_note, t.vat_exemption_note) as vat_exemption_note
  from public.tenants t
  left join public.team_finance_settings s
    on s.tenant_id = t.id
   and s.team_id = p_team_id
   -- Чужая команда — ставка аккаунта, а не её собственная.
   and (
     public.current_user_role() = 'owner'
     or exists (
       select 1 from public.member_calendars mc
        where mc.tenant_id = t.id and mc.user_id = auth.uid() and mc.team_id = p_team_id
     )
   )
  where t.id = public.current_tenant_id();
$function$;

-- 4. Деньги счёта
create or replace function public.accounts_money_columns_owner_only()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if current_user in ('authenticated', 'anon')
     and public.current_user_role() is distinct from 'owner'
     and (new.opening_balance is distinct from old.opening_balance
          or new.vat_mode is distinct from old.vat_mode) then
    raise exception 'Начальный остаток и VAT счёта меняет только владелец'
      using errcode = '42501', hint = 'access:account_money';
  end if;
  return new;
end;
$function$;

revoke all on function public.accounts_money_columns_owner_only() from public, anon, authenticated;

drop trigger if exists accounts_money_columns_owner_only on public.accounts;
create trigger accounts_money_columns_owner_only
  before update on public.accounts
  for each row execute function public.accounts_money_columns_owner_only();
