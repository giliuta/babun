-- «ФАЙЛЫ» ПАРТНЁРА (владелец 04.10, мозговой штурм страницы партнёра:
-- «да, давай делай»). Договор, копия документа, сертификаты — на его
-- странице, рядом с «Выплатами», а не в галерее телефона владельца.
--
-- Тот же уклад, что у файлов клиента (`client_attachments`): строка с
-- метаданными + объект в закрытом бакете по пути
-- `{tenant_id}/{master_id}/{id}.{ext}`, ссылки — подписанные на 5 минут.
--
-- Кто: файлы — часть страницы партнёра, поэтому их держит право
-- «Партнёры» (`company.partners`): «Видит» — смотрит, «Меняет» — добавляет
-- и удаляет. У владельца аккаунта оно всегда есть. Сам партнёр своих файлов
-- здесь не видит: это бумаги владельца о нём.

set local lock_timeout = '5s';

create table public.partner_files (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  master_id text not null,
  storage_path text not null unique,
  filename text not null check (length(btrim(filename)) between 1 and 255),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain')),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  created_by uuid,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, master_id) references public.masters (tenant_id, id) on delete cascade,
  -- Путь объекта — только внутри своей компании и своей карточки.
  check (split_part(storage_path, '/', 1) = tenant_id::text and split_part(storage_path, '/', 2) = master_id)
);

create index partner_files_master_idx on public.partner_files (tenant_id, master_id, created_at desc);

-- Автор — тот, кто вошёл, а не то, что прислал телефон.
create or replace function public.partner_files_stamp_author()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.created_by := auth.uid();
  return new;
end;
$$;

create trigger partner_files_stamp_author
  before insert on public.partner_files
  for each row execute function public.partner_files_stamp_author();

revoke all on function public.partner_files_stamp_author() from public, anon, authenticated;

alter table public.partner_files enable row level security;

create policy partner_files_select on public.partner_files
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.access_company('company.partners', 'read'))
  );

create policy partner_files_insert on public.partner_files
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.access_company('company.partners', 'write'))
  );

create policy partner_files_delete on public.partner_files
  for delete to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.access_company('company.partners', 'write'))
  );

grant select, insert, delete on public.partner_files to authenticated;
revoke all on public.partner_files from anon;

-- ─── Бакет и его правила ───

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'partner-files', 'partner-files', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain']
)
on conflict (id) do nothing;

-- Объект — только для существующей строки: путь сверяется с таблицей, так
-- что положить или стереть чужое по выдуманному пути нельзя. Удаление
-- объекта видит его через SELECT (без него `remove()` молча ничего не
-- стирает), поэтому правило чтения — то же, что у строки.
create policy storage_partner_files_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'partner-files'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and (select public.access_company('company.partners', 'read'))
  );

create policy storage_partner_files_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'partner-files'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and (select public.access_company('company.partners', 'write'))
    and exists (
      select 1 from public.partner_files f
       where f.storage_path = name
         and f.tenant_id = (select public.current_tenant_id())
    )
  );

create policy storage_partner_files_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'partner-files'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
    and (select public.access_company('company.partners', 'write'))
  );

do $guard$
begin
  if has_table_privilege('anon', 'public.partner_files', 'select') then
    raise exception 'сторож: файлы партнёров открыты anon';
  end if;
  if not exists (select 1 from storage.buckets where id = 'partner-files' and public = false) then
    raise exception 'сторож: бакет файлов партнёров не закрыт';
  end if;
end
$guard$;
