-- ГОТОВЫЕ ИСТОЧНИКИ — ОБЫЧНЫЕ СТРОКИ СПРАВОЧНИКА КОМАНДЫ (владелец 03.10:
-- «сделай просто стандартные источники, такие, какие я могу править; если
-- мне не нужен Instagram — могу его вообще удалить; и добавлять новые»).
--
-- До этой миграции восемь готовых («Рекомендация», «Instagram»…) жили в коде
-- и не правились, а `client_sources` держала только свои. Теперь каждая
-- команда получает восемь строк засевом, и дальше они ничем не отличаются от
-- своих: переименовать, удалить, переставить.
--
-- • `key` — какой готовый вариант строка начинала (у своих — пусто). По нему
--   «Рекомендация» и после переименования открывает «Кто привёл», и по нему
--   старое значение клиента (`instagram`) находит строку своей команды.
-- • Засев — новой команде триггером, существующим — здесь же. Удалённый
--   готовый не возвращается: засев идёт только при рождении команды.
-- • Клиенты со старым ключом переводятся на строку своей команды
--   (`src:<id>`), чтобы переименование было видно и у них.

set local lock_timeout = '5s';

alter table public.client_sources
  add column if not exists key text;

alter table public.client_sources drop constraint if exists client_sources_key_known;
alter table public.client_sources add constraint client_sources_key_known check (
  key is null
  or key in ('referral', 'instagram', 'whatsapp', 'google_maps', 'website', 'repeat', 'walk_in', 'other')
);

create unique index if not exists client_sources_team_key
  on public.client_sources (tenant_id, team_id, key)
  where key is not null;

create or replace function public.seed_client_sources(p_tenant uuid, p_team text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.client_sources (tenant_id, team_id, name, position, key)
  select p_tenant, p_team, v.name, v.pos, v.key
    from (values
      ('referral', 'Рекомендация', 0),
      ('instagram', 'Instagram', 1),
      ('whatsapp', 'WhatsApp', 2),
      ('google_maps', 'Google Maps', 3),
      ('website', 'Сайт', 4),
      ('repeat', 'Повторный', 5),
      ('walk_in', 'Проездом', 6),
      ('other', 'Другое', 7)
    ) as v(key, name, pos)
  on conflict do nothing;
$$;

revoke all on function public.seed_client_sources(uuid, text) from public, anon, authenticated;

create or replace function public.teams_seed_client_sources()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_client_sources(new.tenant_id, new.id);
  return new;
end;
$$;

revoke all on function public.teams_seed_client_sources() from public, anon, authenticated;

drop trigger if exists teams_seed_client_sources on public.teams;
create trigger teams_seed_client_sources
  after insert on public.teams
  for each row execute function public.teams_seed_client_sources();

-- Существующие команды.
select public.seed_client_sources(t.tenant_id, t.id) from public.teams t;

-- Клиенты со старым ключом — на строку своей команды.
update public.clients c
   set acquisition_source = 'src:' || s.id::text
  from public.client_sources s
 where s.tenant_id = c.tenant_id
   and s.team_id = c.team_id
   and s.key = c.acquisition_source;
