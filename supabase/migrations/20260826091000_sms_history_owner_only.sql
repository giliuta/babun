-- SMS-история закрывается до владельца.
--
-- ЧТО ТЕКЛО. sms_logs (20260504_001) и sms_messages (20260502_001) отдавали
-- SELECT любому члену тенанта — «диспетчеру полезно отлаживать доставку».
-- Но в этих таблицах лежат телефоны клиентов (to_phone) и тексты сообщений
-- (body). То есть мастер, который по политике 20260720210003 видит только
-- своих клиентов и без телефонов, мог выгрузить телефонную книгу целиком
-- одним запросом к истории SMS.
--
-- ПОЧЕМУ ИМЕННО OWNER, А НЕ owner+dispatcher. Так уже устроен весь остальной
-- SMS-слой, и решение должно жить в одном месте:
--   * tenant_sms_summary() отдаёт последние 20 логов только владельцу
--     (иначе v_logs := '[]'),
--   * sms_topups_select_owner — тот же гейт на платёжной истории.
-- RLS просто перестала расходиться с RPC.
--
-- ЕСЛИ ДИСПЕТЧЕРУ ИСТОРИЯ ВСЁ-ТАКИ НУЖНА — расширять надо НЕ политику, а
-- tenant_sms_summary(): отдать ему узкую проекцию без `body` и с маскированным
-- `to_phone`. Тогда «кому что видно» останется одним решением, а не разъедется
-- между RPC и RLS второй раз.
--
-- Писателей правка не трогает: вставляют и обновляют только service_role
-- (edge-функции send_sms и twilio-status), у них свои `for all` политики.
-- Серверные читатели — SECURITY DEFINER (tenant_sms_summary, админские RPC,
-- GDPR-экспорт), RLS они и так обходят.

-- Оба drop'а идемпотентны: и старое имя, и новое. Иначе повторный прогон файла
-- (восстановление из репозитория, `db reset`) падает на «policy already exists».
drop policy if exists sms_logs_select_member on public.sms_logs;
drop policy if exists sms_logs_select_owner on public.sms_logs;

create policy sms_logs_select_owner
  on public.sms_logs for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  );

drop policy if exists sms_messages_tenant_select on public.sms_messages;
drop policy if exists sms_messages_select_owner on public.sms_messages;

create policy sms_messages_select_owner
  on public.sms_messages for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() = 'owner'
  );

comment on policy sms_logs_select_owner on public.sms_logs is
  'Телефоны клиентов и статусы доставки — только владельцу. Диспетчеру '
  'историю давать через tenant_sms_summary(), а не через RLS.';

comment on policy sms_messages_select_owner on public.sms_messages is
  'Тексты сообщений и телефоны получателей — только владельцу.';
