-- Role/RLS hardening for the native CRM.
-- The 14-digit prefix is a unique Supabase CLI migration version.
-- Safe rollout: nullable auth-member -> master link, no destructive backfill,
-- no production data writes outside the validated metadata backfill below.

-- ── 1. Auth membership -> employee identity ──────────────────────────
alter table public.tenant_members
  add column if not exists master_id text;

-- Preserve deployments that already stored the intended link in metadata.
-- Only valid same-tenant master ids are copied; malformed/stale values stay NULL.
update public.tenant_members tm
   set master_id = nullif(btrim(tm.metadata ->> 'master_id'), '')
 where tm.master_id is null
   and nullif(btrim(tm.metadata ->> 'master_id'), '') is not null
   and exists (
     select 1
       from public.masters m
      where m.tenant_id = tm.tenant_id
        and m.id = nullif(btrim(tm.metadata ->> 'master_id'), '')
   );

create index if not exists idx_tenant_members_master
  on public.tenant_members(tenant_id, master_id)
  where master_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tenant_members'::regclass
       and conname = 'tenant_members_master_fkey'
  ) then
    alter table public.tenant_members
      add constraint tenant_members_master_fkey
      foreign key (tenant_id, master_id)
      references public.masters(tenant_id, id)
      not valid;
  end if;
end $$;

alter table public.tenant_members
  validate constraint tenant_members_master_fkey;

-- Stable helpers used by RLS. SECURITY DEFINER avoids policy recursion through
-- tenant_members/teams; each helper still pins auth.uid + active tenant.
create or replace function public.current_user_master_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select tm.master_id
    from public.tenant_members tm
   where tm.tenant_id = public.current_tenant_id()
     and tm.user_id = auth.uid()
   limit 1
$$;

revoke all on function public.current_user_master_id() from public;
grant execute on function public.current_user_master_id() to authenticated;

create or replace function public.current_user_team_ids()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  with identity as (
    select public.current_user_master_id() as master_id,
           public.current_tenant_id() as tenant_id
  ), assigned as (
    select m.team_id as team_id
      from public.masters m
      join identity i on i.tenant_id = m.tenant_id and i.master_id = m.id
     where m.team_id is not null
    union
    select t.id
      from public.teams t
      cross join identity i
     where t.tenant_id = i.tenant_id
       and i.master_id is not null
       and (
         coalesce(t.lead_ids, '[]'::jsonb) ? i.master_id
         or coalesce(t.helper_ids, '[]'::jsonb) ? i.master_id
         or exists (
           select 1
             from jsonb_array_elements(
               case
                 when jsonb_typeof(t.members) = 'array' then t.members
                 else '[]'::jsonb
               end
             ) member
            where case jsonb_typeof(member)
              when 'string' then member #>> '{}'
              when 'object' then coalesce(member ->> 'master_id', member ->> 'id')
              else null
            end = i.master_id
         )
       )
  )
  select coalesce(array_agg(distinct team_id order by team_id), array[]::text[])
    from assigned
   where team_id is not null
$$;

revoke all on function public.current_user_team_ids() from public;
grant execute on function public.current_user_team_ids() to authenticated;

-- ── 2. Reference data ────────────────────────────────────────────────
drop policy if exists tenants_select_member on public.tenants;
create policy tenants_select_member on public.tenants for select
  to authenticated
  using (
    id = public.current_tenant_id()
    and public.current_user_role() is not null
  );

-- Calendar operation is available to dispatchers, but company-wide hours and
-- grid configuration are owner settings. Day labels/extras keep their existing
-- owner+dispatcher operational policies.
drop policy if exists team_schedules_select_member on public.team_schedules;
create policy team_schedules_select_member on public.team_schedules for select
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() is not null
  );
drop policy if exists team_schedules_modify_owner_or_dispatcher on public.team_schedules;
drop policy if exists team_schedules_write_owner on public.team_schedules;
create policy team_schedules_write_owner on public.team_schedules for all
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  );

drop policy if exists calendar_settings_select_member on public.calendar_settings;
create policy calendar_settings_select_member on public.calendar_settings for select
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() is not null
  );
drop policy if exists calendar_settings_modify_owner_or_dispatcher on public.calendar_settings;
drop policy if exists calendar_settings_write_owner on public.calendar_settings;
create policy calendar_settings_write_owner on public.calendar_settings for all
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  );

drop policy if exists teams_tenant_all on public.teams;
drop policy if exists teams_select_member on public.teams;
drop policy if exists teams_write_owner on public.teams;
create policy teams_select_member on public.teams for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() is not null
  );
create policy teams_write_owner on public.teams for all to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  );

drop policy if exists masters_tenant_all on public.masters;
drop policy if exists masters_select_by_role on public.masters;
drop policy if exists masters_write_owner on public.masters;
create policy masters_select_by_role on public.masters for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (
      public.current_user_role() in ('owner', 'dispatcher')
      or (
        public.current_user_role() = 'master'
        and id = public.current_user_master_id()
      )
    )
  );
create policy masters_write_owner on public.masters for all to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  );

drop policy if exists service_categories_tenant_all on public.service_categories;
drop policy if exists service_categories_select_member on public.service_categories;
drop policy if exists service_categories_write_owner on public.service_categories;
create policy service_categories_select_member on public.service_categories for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() is not null
  );
create policy service_categories_write_owner on public.service_categories for all to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  );

drop policy if exists services_tenant_all on public.services;
drop policy if exists services_select_member on public.services;
drop policy if exists services_write_owner on public.services;
create policy services_select_member on public.services for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() is not null
  );
create policy services_write_owner on public.services for all to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  );

drop policy if exists cities_tenant_all on public.cities;
drop policy if exists cities_select_member on public.cities;
drop policy if exists cities_write_operations on public.cities;
create policy cities_select_member on public.cities for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() is not null
  );
create policy cities_write_operations on public.cities for all to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('owner', 'dispatcher')
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('owner', 'dispatcher')
  );

drop policy if exists equipment_tenant_all on public.equipment;
drop policy if exists equipment_select_by_role on public.equipment;
drop policy if exists equipment_write_owner on public.equipment;
create policy equipment_select_by_role on public.equipment for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (
      public.current_user_role() in ('owner', 'dispatcher')
      or (
        public.current_user_role() = 'master'
        and assigned_team_id = any(public.current_user_team_ids())
      )
    )
  );
create policy equipment_write_owner on public.equipment for all to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  );

-- Loyalty rules are operationally readable but company-managed.
drop policy if exists tenant_loyalty_settings_tenant_all on public.tenant_loyalty_settings;
drop policy if exists tenant_loyalty_settings_select_member on public.tenant_loyalty_settings;
drop policy if exists tenant_loyalty_settings_write_owner on public.tenant_loyalty_settings;
create policy tenant_loyalty_settings_select_member on public.tenant_loyalty_settings
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() is not null
  );
create policy tenant_loyalty_settings_write_owner on public.tenant_loyalty_settings
  for all to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  );

-- ── 3. Owner-only finance and invoices ───────────────────────────────
drop policy if exists accounts_tenant_all on public.accounts;
drop policy if exists accounts_owner_all on public.accounts;
create policy accounts_owner_all on public.accounts for all to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  );

drop policy if exists invoices_tenant_all on public.invoices;
drop policy if exists invoices_owner_all on public.invoices;
create policy invoices_owner_all on public.invoices for all to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  );

drop policy if exists invoice_lines_via_invoice on public.invoice_lines;
drop policy if exists invoice_lines_owner_all on public.invoice_lines;
create policy invoice_lines_owner_all on public.invoice_lines for all to authenticated
  using (
    public.current_user_role() = 'owner'
    and exists (
      select 1 from public.invoices i
       where i.id = invoice_lines.invoice_id
         and i.tenant_id = public.current_tenant_id()
    )
  )
  with check (
    public.current_user_role() = 'owner'
    and exists (
      select 1 from public.invoices i
       where i.id = invoice_lines.invoice_id
         and i.tenant_id = public.current_tenant_id()
    )
  );

drop policy if exists finance_templates_tenant_all on public.finance_templates;
drop policy if exists finance_templates_owner_all on public.finance_templates;
create policy finance_templates_owner_all on public.finance_templates for all to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  );

drop policy if exists finance_tx_all_own on public.finance_transactions;
drop policy if exists finance_transactions_owner_all on public.finance_transactions;
create policy finance_transactions_owner_all on public.finance_transactions for all to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  );

drop policy if exists finance_categories_read_any on public.finance_categories;
drop policy if exists finance_categories_write_own on public.finance_categories;
drop policy if exists finance_categories_owner_select on public.finance_categories;
drop policy if exists finance_categories_owner_write on public.finance_categories;
create policy finance_categories_owner_select on public.finance_categories
  for select to authenticated
  using (
    public.current_user_role() = 'owner'
    and (tenant_id is null or tenant_id = public.current_tenant_id())
  );
create policy finance_categories_owner_write on public.finance_categories
  for all to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  );

-- Ledger writes caused by an appointment status transition are system writes,
-- not a grant to the acting dispatcher/master. Pin search_path and run them as
-- their function owner so owner-only finance RLS does not break completion.
alter function public.sync_appointment_finance() security definer;
alter function public.sync_appointment_finance() set search_path = public;
alter function public.sync_appointment_finance_insert() security definer;
alter function public.sync_appointment_finance_insert() set search_path = public;
revoke all on function public.sync_appointment_finance() from public, anon, authenticated;
revoke all on function public.sync_appointment_finance_insert() from public, anon, authenticated;

-- ── 4. Assigned work for master accounts ─────────────────────────────
drop policy if exists appointments_select on public.appointments;
drop policy if exists appointments_insert on public.appointments;
drop policy if exists appointments_update on public.appointments;
drop policy if exists appointments_delete on public.appointments;

create policy appointments_select on public.appointments for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (
      (kind in ('event', 'personal') and created_by = auth.uid())
      or (
        kind = 'work'
        and (
          public.current_user_role() in ('owner', 'dispatcher')
          or (
            public.current_user_role() = 'master'
            and (
              master_id = public.current_user_master_id()
              or team_id = any(public.current_user_team_ids())
            )
          )
        )
      )
    )
  );

create policy appointments_insert on public.appointments for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and (
      (kind = 'work' and public.current_user_role() in ('owner', 'dispatcher'))
      or (
        kind in ('event', 'personal')
        and (created_by is null or created_by = auth.uid())
      )
    )
  );

create policy appointments_update on public.appointments for update to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (
      (kind in ('event', 'personal') and created_by = auth.uid())
      or (
        kind = 'work'
        and (
          public.current_user_role() in ('owner', 'dispatcher')
          or (
            public.current_user_role() = 'master'
            and (
              master_id = public.current_user_master_id()
              or team_id = any(public.current_user_team_ids())
            )
          )
        )
      )
    )
  )
  with check (
    tenant_id = public.current_tenant_id()
    and (
      (kind in ('event', 'personal') and created_by = auth.uid())
      or (
        kind = 'work'
        and (
          public.current_user_role() in ('owner', 'dispatcher')
          or (
            public.current_user_role() = 'master'
            and (
              master_id = public.current_user_master_id()
              or team_id = any(public.current_user_team_ids())
            )
          )
        )
      )
    )
  );

create policy appointments_delete on public.appointments for delete to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and (
      (kind = 'work' and public.current_user_role() in ('owner', 'dispatcher'))
      or (kind in ('event', 'personal') and created_by = auth.uid())
    )
  );

-- Complete column guard. For work, master may change only status/comment.
-- Own personal events retain their date/text/push editing flow while client,
-- assignment, service and finance columns remain immutable.
create or replace function public.appointments_master_column_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if public.current_user_role() is distinct from 'master' then
    return new;
  end if;

  if old.kind = 'work' then
    if new.id is distinct from old.id
      or new.tenant_id is distinct from old.tenant_id
      or new.client_id is distinct from old.client_id
      or new.team_id is distinct from old.team_id
      or new.master_id is distinct from old.master_id
      or new.location_id is distinct from old.location_id
      or new.date is distinct from old.date
      or new.time_start is distinct from old.time_start
      or new.time_end is distinct from old.time_end
      or new.kind is distinct from old.kind
      or new.total_amount is distinct from old.total_amount
      or new.custom_total is distinct from old.custom_total
      or new.discount_amount is distinct from old.discount_amount
      or new.prepaid_amount is distinct from old.prepaid_amount
      or new.paid_amount is distinct from old.paid_amount
      or new.payment_status is distinct from old.payment_status
      or new.payment_method is distinct from old.payment_method
      or new.address is distinct from old.address
      or new.address_note is distinct from old.address_note
      or new.address_lat is distinct from old.address_lat
      or new.address_lng is distinct from old.address_lng
      or new.cancel_reason is distinct from old.cancel_reason
      or new.source is distinct from old.source
      or new.is_online_booking is distinct from old.is_online_booking
      or new.consent_given is distinct from old.consent_given
      or new.color_override is distinct from old.color_override
      or new.reminder_enabled is distinct from old.reminder_enabled
      or new.reminder_offsets is distinct from old.reminder_offsets
      or new.reminder_template is distinct from old.reminder_template
      or new.service_ids is distinct from old.service_ids
      or new.services is distinct from old.services
      or new.service_price_overrides is distinct from old.service_price_overrides
      or new.expenses is distinct from old.expenses
      or new.payments is distinct from old.payments
      or new.payment is distinct from old.payment
      or new.global_discount is distinct from old.global_discount
      or new.total_duration is distinct from old.total_duration
      or new.event_all_day is distinct from old.event_all_day
      or new.event_notes is distinct from old.event_notes
      or new.event_url is distinct from old.event_url
      or new.event_push_enabled is distinct from old.event_push_enabled
      or new.event_push_offsets is distinct from old.event_push_offsets
      or new.event_push_at is distinct from old.event_push_at
      or new.event_repeat is distinct from old.event_repeat
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at
      or new.updated_at is distinct from old.updated_at
      or new.is_demo is distinct from old.is_demo then
      raise exception 'master role can only update status and comment on work appointments'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if old.kind in ('event', 'personal') then
    if old.created_by is distinct from auth.uid()
      or new.id is distinct from old.id
      or new.tenant_id is distinct from old.tenant_id
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at
      or new.kind is distinct from old.kind
      or new.client_id is distinct from old.client_id
      or new.team_id is distinct from old.team_id
      or new.master_id is distinct from old.master_id
      or new.location_id is distinct from old.location_id
      or new.total_amount is distinct from old.total_amount
      or new.custom_total is distinct from old.custom_total
      or new.discount_amount is distinct from old.discount_amount
      or new.prepaid_amount is distinct from old.prepaid_amount
      or new.paid_amount is distinct from old.paid_amount
      or new.payment_status is distinct from old.payment_status
      or new.payment_method is distinct from old.payment_method
      or new.service_ids is distinct from old.service_ids
      or new.services is distinct from old.services
      or new.service_price_overrides is distinct from old.service_price_overrides
      or new.expenses is distinct from old.expenses
      or new.payments is distinct from old.payments
      or new.payment is distinct from old.payment
      or new.global_discount is distinct from old.global_discount
      or new.source is distinct from old.source
      or new.is_online_booking is distinct from old.is_online_booking
      or new.consent_given is distinct from old.consent_given
      or new.reminder_enabled is distinct from old.reminder_enabled
      or new.reminder_offsets is distinct from old.reminder_offsets
      or new.reminder_template is distinct from old.reminder_template
      or new.is_demo is distinct from old.is_demo then
      raise exception 'master role cannot change assignment, client or finance fields on a personal event'
        using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception 'unsupported appointment kind for master role'
    using errcode = '42501';
end;
$$;

drop trigger if exists appointments_master_column_guard on public.appointments;
create trigger appointments_master_column_guard
  before update on public.appointments
  for each row execute function public.appointments_master_column_guard();

revoke all on function public.appointments_master_column_guard() from public, anon, authenticated;

-- Photo metadata follows appointment visibility. Blob storage remains a
-- separate rollout because the legacy bucket is public and clients currently
-- consume public URLs; changing that without signed-URL code would break media.
drop policy if exists appointment_photos_all_member on public.appointment_photos;
drop policy if exists appointment_photos_by_appointment on public.appointment_photos;
create policy appointment_photos_by_appointment on public.appointment_photos
  for all to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and exists (
      select 1 from public.appointments a
       where a.id = appointment_photos.appointment_id
         and a.tenant_id = appointment_photos.tenant_id
    )
  )
  with check (
    tenant_id = public.current_tenant_id()
    and exists (
      select 1 from public.appointments a
       where a.id = appointment_photos.appointment_id
         and a.tenant_id = appointment_photos.tenant_id
    )
  );

-- Deployment assertions: fail the migration rather than silently shipping a
-- half-installed identity link or invoker-mode finance trigger.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'tenant_members'
       and column_name = 'master_id'
  ) then
    raise exception 'role hardening: tenant_members.master_id missing';
  end if;
  if not exists (
    select 1 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'sync_appointment_finance'
       and p.prosecdef
  ) then
    raise exception 'role hardening: finance trigger is not SECURITY DEFINER';
  end if;
  if (select count(*) from pg_policies
       where schemaname = 'public'
         and policyname in (
           'teams_write_owner',
           'masters_write_owner',
           'accounts_owner_all',
           'invoices_owner_all',
           'finance_transactions_owner_all',
           'appointments_select'
         )) <> 6 then
    raise exception 'role hardening: expected RLS policies are missing';
  end if;
end $$;
