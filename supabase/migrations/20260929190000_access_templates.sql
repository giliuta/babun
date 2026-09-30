-- ШАБЛОНЫ ДОСТУПА (владелец 29.09: «давать ему разрешение очень правильно,
-- точечно… с шаблонами того, что он может видеть и что не может»).
--
-- Шаблон — именованный набор положений прав КОМАНДЫ («Календарь», «Запись»,
-- «Финансы», «Клиенты»): { "record.client": "read", "clients": "off", … }.
-- Применяется КОПИЕЙ (решение 29.09): при добавлении человека в команду или
-- со страницы его прав в команде положения шаблона записываются в
-- `member_access` обычной дверью `set_member_access` (её проверки и сторожа —
-- как у ручной правки). Правка шаблона потом людей не трогает.
--
-- Заводит, правит и видит шаблоны только владелец компании.

set local lock_timeout = '5s';

create table if not exists public.access_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  levels jsonb not null default '{}'::jsonb check (jsonb_typeof(levels) = 'object'),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists access_templates_tenant_idx
  on public.access_templates (tenant_id, position);

alter table public.access_templates enable row level security;

create policy access_templates_owner_all on public.access_templates
  for all
  to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and (select public.current_user_role()) = 'owner')
  with check (tenant_id = (select public.current_tenant_id())
              and (select public.current_user_role()) = 'owner');

revoke all on public.access_templates from anon;
grant select, insert, update, delete on public.access_templates to authenticated;

-- СТОРОЖ: RLS включена, анониму таблица закрыта.
do $guard$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.access_templates'::regclass) then
    raise exception 'у шаблонов доступа выключена RLS';
  end if;
  if has_table_privilege('anon', 'public.access_templates', 'select') then
    raise exception 'шаблоны доступа видны без входа';
  end if;
end;
$guard$;
