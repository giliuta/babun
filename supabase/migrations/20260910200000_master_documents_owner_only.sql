-- Кадровые документы мастера — только владельцу.
--
-- Политика `master_docs_all_own` (20260517_003_webhooks_master_docs_ratings.sql)
-- была написана в эпоху «все свои в одном тенанте»: `for all to anon,
-- authenticated using (tenant_id = current_tenant_id())`. То есть ЛЮБОЙ
-- участник компании — включая обычного мастера — читал и УДАЛЯЛ кадровые
-- документы всех остальных мастеров. Это не гипотеза: политика живая, и она
-- ровно того класса, ради которого писалась 20260720210003_master_privacy_
-- hardening (мастер не получает сырых строк вообще).
--
-- Модель прав переезжает на календари, и до неё эта таблица не имеет права
-- дожить в нынешнем виде. Пока UI документов не существует (в приложении нет
-- ни одного обращения к master_documents, в боевой базе ноль строк), самый
-- честный предикат — владелец компании. Мастеру свои документы отдаст
-- отдельная безопасная функция, когда экран появится.

drop policy if exists master_docs_all_own on public.master_documents;

create policy master_documents_owner_all on public.master_documents
  for all
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  );

comment on policy master_documents_owner_all on public.master_documents is
  'Кадровые документы видит и правит только владелец компании. Прежняя '
  'master_docs_all_own отдавала их (и право удаления) любому участнику '
  'тенанта, включая мастера.';

-- Deploy-ассерт: разрешающей политики для не-владельца остаться не должно.
do $$
begin
  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'master_documents'
       and policyname = 'master_docs_all_own'
  ) then
    raise exception 'master_documents: старая политика пережила миграцию';
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'master_documents'
       and policyname = 'master_documents_owner_all'
       and qual like '%current_user_role%'
  ) then
    raise exception 'master_documents: владельческая политика не встала';
  end if;
end $$;
