-- НОМЕР ДОКУМЕНТА ВРУЧНУЮ — В ЛЮБОЙ МОМЕНТ, ДАЛЬШЕ СЕРИЯ ИДЁТ ОТ НЕГО
-- (владелец 2026-10-03: «он идёт автоматически последовательно, но если мне
-- нужно, я могу изменить номер вручную — вместо 005 написать свой»).
--
-- С 01.10 (STORY-101) номер задавался только СТАРТОМ серии — пока в году у
-- юрлица нет ни одного документа. Теперь владелец ставит следующий номер
-- когда угодно; единственное правило — вперёд: номер не ниже уже выданного
-- (`invoices_series_seq_key` / `ux_receipts_number` всё равно не пустят
-- дубль, но отказ должен прийти словами сейчас, а не ошибкой выпуска потом).
--
-- Тела `set_document_series_start` и `peek_document_number` — из живого
-- `pg_get_functiondef`, меняется по одному условию.

set local lock_timeout = '5s';

create or replace function public.document_series_max_seq(
  p_tenant_id uuid,
  p_legal_entity_id uuid,
  p_doc_type text,
  p_year integer
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(case p_doc_type
    when 'receipt' then (
      select max(receipt.seq) from public.receipts receipt
       where receipt.tenant_id = p_tenant_id
         and receipt.company_id = p_legal_entity_id
         and receipt.year = p_year
    )
    else (
      select max(invoice.seq) from public.invoices invoice
       where invoice.tenant_id = p_tenant_id
         and invoice.company_id = p_legal_entity_id
         and invoice.kind = case p_doc_type when 'credit_note' then 'credit_note' else 'invoice' end
         and invoice.year = p_year
    )
  end, 0)
$$;

revoke all on function public.document_series_max_seq(uuid, uuid, text, integer) from public, anon, authenticated;

do $patch$
declare
  def text;
  needle text;
  replacement text;
begin
  -- 1. Старт серии → «следующий номер» в любой момент, только вперёд.
  def := pg_get_functiondef('public.set_document_series_start(uuid, text, integer, integer)'::regprocedure);
  needle := E'  if public.document_series_started(tenant_uuid, entity.id, p_doc_type, p_year) then\n'
         || E'    raise exception ''Серия % года уже начата — номер задаётся только до первого документа'', p_year;\n'
         || E'  end if;';
  replacement := E'  if p_next_number <= public.document_series_max_seq(tenant_uuid, entity.id, p_doc_type, p_year) then\n'
         || E'    raise exception ''Номер % уже выдан — следующий может быть от %'',\n'
         || E'      p_next_number, public.document_series_max_seq(tenant_uuid, entity.id, p_doc_type, p_year) + 1;\n'
         || E'  end if;';
  if (length(def) - length(replace(def, needle, ''))) / length(needle) <> 1 then
    raise exception 'set_document_series_start: series check not found exactly once';
  end if;
  execute replace(def, needle, replacement);

  -- 2. Владелец может задать номер всегда.
  def := pg_get_functiondef('public.peek_document_number(uuid, text, integer)'::regprocedure);
  needle := E'  can_set_start := public.current_user_role() = ''owner''\n'
         || E'    and not public.document_series_started(tenant_uuid, entity.id, p_doc_type, p_year);';
  replacement := E'  can_set_start := public.current_user_role() = ''owner'';';
  if (length(def) - length(replace(def, needle, ''))) / length(needle) <> 1 then
    raise exception 'peek_document_number: can_set_start not found exactly once';
  end if;
  execute replace(def, needle, replacement);
end
$patch$;

do $guard$
begin
  if position('document_series_started' in (select prosrc from pg_proc
       where oid = 'public.set_document_series_start(uuid, text, integer, integer)'::regprocedure)) > 0 then
    raise exception 'сторож: старт серии всё ещё запрещён после первого документа';
  end if;
  if position('document_series_max_seq' in (select prosrc from pg_proc
       where oid = 'public.set_document_series_start(uuid, text, integer, integer)'::regprocedure)) = 0 then
    raise exception 'сторож: номер не сверяется с уже выданными';
  end if;
  if has_function_privilege('anon', 'public.document_series_max_seq(uuid, uuid, text, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.document_series_max_seq(uuid, uuid, text, integer)', 'execute') then
    raise exception 'сторож: помощник серии доступен снаружи';
  end if;
end
$guard$;
