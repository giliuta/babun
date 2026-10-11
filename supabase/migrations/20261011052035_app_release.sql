-- «ВЫШЛО ОБНОВЛЕНИЕ» (владелец 11.10: «как сделать, чтоб приложение само
-- говорило, что нужно обновиться, после того как обновление вышло в Apple
-- или на Android»).
--
-- Одна строка на платформу: последняя вышедшая версия (ниже — плашка
-- «Доступна новая версия» с кнопкой в магазин) и минимальная допустимая
-- (ниже — экран «Нужно обновить», дальше без обновления не пускает).
-- Меняется руками после каждого выпуска; читают все, включая экран входа
-- без аккаунта, — секретов здесь нет.

create table if not exists public.app_release (
  platform text primary key check (platform in ('ios', 'android')),
  latest_version text not null,
  min_version text not null default '0.0.0',
  store_url text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_release enable row level security;

drop policy if exists app_release_read on public.app_release;
create policy app_release_read on public.app_release
  for select to anon, authenticated using (true);

revoke insert, update, delete on public.app_release from anon, authenticated;
grant select on public.app_release to anon, authenticated;

insert into public.app_release (platform, latest_version, min_version, store_url) values
  ('ios', '1.0.2', '0.0.0', 'https://apps.apple.com/app/id6790366393'),
  ('android', '1.0.0', '0.0.0', 'https://play.google.com/store/apps/details?id=com.babun.crm')
on conflict (platform) do nothing;
