-- «Вести информацию на объектах» — свойство БИЗНЕСА, а не устройства
-- (владелец 2026-08-06: у клинингового или бьюти-бизнеса нет никакой техники
-- на объекте, и второй уровень им только мешает).
--
-- Настройка тенантная, а не местная: включил владелец — мастер на своём
-- телефоне обязан видеть то же самое.
--
-- default true: у всех, кто уже работает, уровень есть, и обновление ничего
-- не должно спрятать.
alter table public.tenants
  add column if not exists track_units boolean not null default true;

comment on column public.tenants.track_units is
  'Показывать ли на объекте клиента список того, что на нём стоит («Информация»). Выключено — уровня нет нигде.';

-- track_units должен доезжать до ВСЕХ ролей: владельцу профиль отдаётся
-- целиком (to_jsonb), а диспетчеру и мастеру — по белому списку полей, и без
-- этой строки они видели бы «Информацию» на объекте даже после того, как
-- владелец её выключил.
create or replace function public.current_tenant_profile_safe()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  select case
    when public.current_user_role() = 'owner' then to_jsonb(t)
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
        'created_at', t.created_at
      )
    else null
  end
    from public.tenants t
   where t.id = public.current_tenant_id()
   limit 1
$function$;
