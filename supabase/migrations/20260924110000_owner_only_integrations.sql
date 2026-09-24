-- ВЕБХУКИ, ПЛАТЁЖНЫЕ СОБЫТИЯ И ОЦЕНКИ — ТОЛЬКО ВЛАДЕЛЬЦУ (STORY-087, аудит
-- 23.09, перед приглашением живых сотрудников).
--
-- Политики этих таблиц проверяли только компанию (`current_tenant_id()`), а не
-- роль: любой сотрудник компании
--   • заводил и читал вебхуки — адрес, куда уходят события компании, и его
--     секрет (`webhooks_all_own`, к тому же открытая и для `anon`);
--   • читал платёжные события подписки (`billing_events_tenant_select`);
--   • выписывал токены оценок и читал оценки — мастер мог сам себе выписать
--     ссылку и поставить себе пять звёзд (`rating_tokens_owner_insert` при
--     имени «owner» проверял только компанию).
-- Приложение эти таблицы сейчас не читает; права сотрудника на них не
-- заведены ни одним блоком. Закрываем ролью владельца.

drop policy if exists webhooks_all_own on public.webhooks;
create policy webhooks_owner_all on public.webhooks
  for all to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and (select public.current_user_role()) = 'owner')
  with check (tenant_id = (select public.current_tenant_id())
              and (select public.current_user_role()) = 'owner');

drop policy if exists billing_events_tenant_select on public.billing_events;
create policy billing_events_owner_select on public.billing_events
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and (select public.current_user_role()) = 'owner');

drop policy if exists rating_tokens_owner_insert on public.master_rating_tokens;
create policy rating_tokens_owner_insert on public.master_rating_tokens
  for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id())
              and (select public.current_user_role()) = 'owner');

drop policy if exists rating_tokens_read_own on public.master_rating_tokens;
create policy rating_tokens_owner_read on public.master_rating_tokens
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and (select public.current_user_role()) = 'owner');

drop policy if exists master_ratings_read_own on public.master_ratings;
create policy master_ratings_owner_read on public.master_ratings
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id())
         and (select public.current_user_role()) = 'owner');

-- ─── Сторож ──────────────────────────────────────────────────────────────
do $audit$
declare
  loose integer;
begin
  select count(*) into loose
    from pg_policies
   where schemaname = 'public'
     and tablename in ('webhooks', 'billing_events', 'master_rating_tokens', 'master_ratings')
     and 'authenticated' = any(roles)
     and coalesce(qual, '') || coalesce(with_check, '') not ilike '%current_user_role%'
     and policyname <> 'master_ratings_insert_with_token';
  if loose > 0 then
    raise exception 'owner-only tables still have % policies without a role check', loose;
  end if;
end
$audit$;
