-- HOTFIX: восстановить public.normalize_client_tag_ids(uuid, uuid[]).
--
-- СИМПТОМ: создание клиента падает в проде —
--   «createClient: function public.normalize_client_tag_ids(uuid, uuid[])
--    does not exist»
--
-- ПРИЧИНА. Набор миграций применён ЧАСТИЧНО:
--   * 20260720210012_atomic_client_tags.sql определяет
--     normalize_client_tag_ids + два триггер-гарда + ПЕРВЫЕ версии
--     create_client_with_tags / update_client_with_tags.
--     → в проде НЕ применена.
--   * 20260722120000_client_city_manual.sql (позже) переопределяет
--     только create_client_with_tags / update_client_with_tags, и обе
--     ВНУТРИ зовут normalize_client_tag_ids.
--     → в проде применена.
-- Итог: RPC существует, а его зависимость — нет. Поэтому обычный
-- fallback в clients.ts (isMissingClientWriteRpc) не срабатывает: он
-- ловит отсутствие САМОЙ RPC, а тут отсутствует то, что она вызывает.
--
-- ⚠️ НЕ ПРИМЕНЯТЬ 20260720210012 ЦЕЛИКОМ, ЧТОБЫ «догнать» состояние.
-- В нём лежат СТАРЫЕ версии create_client_with_tags и
-- update_client_with_tags, и `create or replace` молча откатит их до
-- версии от 20 июля, потеряв всё, что добавила миграция от 22 июля
-- (city_manual). Отсюда — только недостающая функция, ничего больше.
--
-- Тело идентично оригиналу из _012 (скопировано дословно).
-- Идемпотентно: create or replace.

create or replace function public.normalize_client_tag_ids(
  p_tenant_id uuid,
  p_tag_ids uuid[]
)
returns uuid[]
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  normalized_ids uuid[];
begin
  if p_tenant_id is null then
    raise exception 'tenant id is required'
      using errcode = '22023';
  end if;

  if array_position(coalesce(p_tag_ids, array[]::uuid[]), null) is not null then
    raise exception 'client tag ids cannot contain null'
      using errcode = '22023';
  end if;

  select coalesce(
           array_agg(distinct supplied.tag_id order by supplied.tag_id),
           array[]::uuid[]
         )
    into normalized_ids
    from unnest(coalesce(p_tag_ids, array[]::uuid[])) supplied(tag_id);

  if exists (
    select 1
      from unnest(normalized_ids) supplied(tag_id)
     where not exists (
       select 1
         from public.client_tags tag
        where tag.tenant_id = p_tenant_id
          and tag.id = supplied.tag_id
     )
  ) then
    raise exception 'client tag does not belong to the active tenant'
      using errcode = '23503';
  end if;

  return normalized_ids;
end;
$function$;

-- Функция security definer и вызывается только изнутри
-- create_client_with_tags / update_client_with_tags — прямой доступ
-- клиентским ролям не нужен (как в оригинале).
revoke all on function public.normalize_client_tag_ids(uuid, uuid[])
  from public, anon, authenticated;
