-- ТИПЫ СОБЫТИЙ — СПРАВОЧНИК КОМПАНИИ, А НЕ ЛИЧНЫЙ СПИСОК АВТОРА (24.09).
--
-- С 20260624_002 все четыре политики `personal_event_types` требовали
-- `created_by = auth.uid()`: тип, заведённый владельцем, диспетчер не видел
-- и не мог поправить, а мастер не получал списка вовсе. Владелец 24.09:
-- «события нестандартные — каждая компания заводит свои», а «Быстрое событие»
-- (долгое нажатие по свободному месту) предлагает эти типы всем, кто заводит
-- события. Правило теперь то же, что у меток дня (`cities`):
--   • читают все члены компании;
--   • заводят, правят и удаляют владелец и диспетчер.
-- `created_by` остаётся колонкой аудита — в политиках его больше нет.
-- Чтение для `anon` снимается: справочник компании гостям не нужен.

drop policy if exists personal_event_types_select on public.personal_event_types;
drop policy if exists personal_event_types_insert on public.personal_event_types;
drop policy if exists personal_event_types_update on public.personal_event_types;
drop policy if exists personal_event_types_delete on public.personal_event_types;

create policy personal_event_types_select on public.personal_event_types
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_user_role()) is not null
  );

create policy personal_event_types_insert on public.personal_event_types
  for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_user_role()) = any (array['owner', 'dispatcher'])
  );

create policy personal_event_types_update on public.personal_event_types
  for update to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_user_role()) = any (array['owner', 'dispatcher'])
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_user_role()) = any (array['owner', 'dispatcher'])
  );

create policy personal_event_types_delete on public.personal_event_types
  for delete to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_user_role()) = any (array['owner', 'dispatcher'])
  );
