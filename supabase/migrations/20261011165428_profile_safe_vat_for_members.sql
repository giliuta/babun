-- НДС КОМПАНИИ — И СОТРУДНИКУ (аудит 11.10): инвойс партнёра с правом
-- «Документы: Выставляет» читал ставку из `tenants`, закрытой владельцу, и
-- падал на загрузке; в записи и чеке ставка компании выходила 0 %. Режим и
-- ставка НДС — не секрет (печатаются в каждом счёте), поэтому отдаются всем
-- членам компании. Остальное тело — действующее (снято с боевой 11.10).
create or replace function public.current_tenant_profile_safe()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case
    when public.current_user_role() = 'owner' then
      to_jsonb(t) || jsonb_build_object('tier', public.tenant_effective_plan(t.id))
    when public.current_user_role() in ('dispatcher', 'master') then
      jsonb_build_object(
        'id', t.id,
        'name', t.name,
        'vertical', t.vertical,
        'city', t.city,
        'country', t.country,
        'address', t.address,
        'logo_url', t.logo_url,
        'contact_phone', t.contact_phone,
        'contact_email', t.contact_email,
        'contact_whatsapp', t.contact_whatsapp,
        'contact_telegram', t.contact_telegram,
        'contact_instagram', t.contact_instagram,
        'onboarded_at', t.onboarded_at,
        'personal_calendar_enabled', t.personal_calendar_enabled,
        'track_units', t.track_units,
        'currency', t.currency,
        'created_at', t.created_at,
        'tier', public.tenant_effective_plan(t.id),
        'vat_mode', t.vat_mode,
        'vat_rate', t.vat_rate
      )
      || case
        when cardinality(public.access_calendars('finance.documents', 'write')) > 0 then
          jsonb_build_object(
            'invoice_due_days', t.invoice_due_days,
            'invoice_line_source', t.invoice_line_source,
            'invoice_default_line_title', t.invoice_default_line_title,
            'invoice_footer_note', t.invoice_footer_note
          )
        else '{}'::jsonb
      end
      || case
        when public.access_company('cabinet.tariff', 'read') then
          jsonb_build_object(
            'plan', t.plan,
            'plan_override', t.plan_override,
            'trial_tier', t.trial_tier,
            'trial_started_at', t.trial_started_at,
            'trial_ends_at', t.trial_ends_at,
            'subscription_status', t.subscription_status,
            'current_period_end', t.current_period_end,
            'working_team_ids', t.working_team_ids
          )
        else '{}'::jsonb
      end
    else null
  end
    from public.tenants t
   where t.id = public.current_tenant_id()
   limit 1
$function$;
