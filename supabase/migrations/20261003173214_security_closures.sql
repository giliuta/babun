-- ЗАЩИТА ОТ УТЕЧЕК — РАЗБОР 03.10 (владелец: «чтобы не украли ни базу»).
--
-- Разбор шёл по живой базе; здесь — то, что подтвердилось.
--
-- 1. ВЕБ-ПУШ: развёрнутая функция send_push (v10, май) не проверяет
--    вызывающего (verify_jwt=false, секрета нет; в репозитории проверка
--    x-dispatch-secret есть, но на сервер не выложена). Кто угодно мог
--    завести себе подписку с СВОИМ адресом (политика insert проверяла только
--    user_id = auth.uid()) и позвать функцию с event_type owner.new_member и
--    чужим user_id: функция достаёт почту жертвы и шлёт её пушем ему. Веб-пуш
--    — наследие старого веба: мобильное приложение подписок не заводит, в
--    базе одна подписка с мая. Заводить новые подписки больше нельзя; саму
--    функцию — выложить из репозитория (делает владелец).
--
-- 2. SMS ЗАПИСИ (sms_for_appointment): отдавала шаблоны, тексты SMS (имя,
--    дата, адрес) и ответ клиента всякому, кто прикреплён к команде записи,
--    — даже со «Скрыт» на «Записях клиентов» и «Клиенте в записи». Теперь
--    не владельцу нужны оба права на команду записи. Правка одного места
--    живого тела, md5 сверяется.
--
-- 3. ЛОГОТИПЫ (tenant-logos): политика чтения была выдана всем (PUBLIC) —
--    без входа перечислялись файлы и папки, то есть id всех компаний. Бакет
--    публичный: картинки по ссылке отдаются и без политики. Чтение списка —
--    только своей папки.
--
-- 4. АВАТАРЫ (client-avatars): бакет не используется (0 файлов), а политики
--    давали любому участнику читать, перезаписывать и удалять всё в папке
--    компании. Политики сняты — бакет доступен только сервису.
--
-- 5. SMS ЗА ДЕНЬГИ ВЛАДЕЛЬЦА (sms_send_manual): из записи SMS клиенту записи
--    шло по одному праву видеть календарь. Партнёр со «SMS: Скрыт» слал из
--    любой записи команды любой текст до 1000 знаков — до €36 в день на
--    человека с баланса владельца, с автопополнением с его карты. Теперь
--    «SMS: Меняет» нужно на КАЖДУЮ отправку не владельца.
--
-- 6. ОТМЕНА ОПЛАЧЕННОЙ ЗАПИСИ = ВОЗВРАТ (member_appointment_update): сверка
--    финансов на отмене пишет возврат всех денег записи. Право «Отменять
--    записи» проводило такой возврат мимо права «Оплата в записи»: наличные
--    в книгах «вернулись клиенту». Теперь отменить запись с деньгами
--    партнёр может только с «Оплата в записи: Меняет».

-- ── 1 ─────────────────────────────────────────────────────────────────────
drop policy if exists push_subscriptions_insert_own on public.push_subscriptions;

-- ── 2 ─────────────────────────────────────────────────────────────────────
do $migration$
declare
  fn regprocedure := 'public.sms_for_appointment(uuid)'::regprocedure;
  def text;
  anchor text := $old$  if not found or not public.sms_can_see_team(a.team_id) then
    raise exception 'sms:rights' using errcode = '42501';
  end if;$old$;
  addition text := $new$  if not found or not public.sms_can_see_team(a.team_id) then
    raise exception 'sms:rights' using errcode = '42501';
  end if;
  -- ТЕКСТЫ SMS — О КЛИЕНТЕ ЗАПИСИ (аудит 03.10): имя, дата, адрес и ответ
  -- клиента. Не владельцу — только с «Записями клиентов» и «Клиентом в
  -- записи» на команду записи, а не по одному прикреплению к команде.
  if not is_owner and not (
       a.team_id = any(public.access_calendars('calendar.records', 'read'))
       and a.team_id = any(public.access_calendars('record.client', 'read'))
     ) then
    raise exception 'sms:rights' using errcode = '42501';
  end if;$new$;
begin
  if (select md5(prosrc) from pg_proc where oid = fn) <> '808e395c496f2214e765035eec426b89' then
    raise exception 'sms_for_appointment изменилась после разбора 03.10 — перечитать тело перед правкой';
  end if;
  def := pg_get_functiondef(fn);
  if (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'проверка видимости команды не найдена ровно один раз';
  end if;
  execute replace(def, anchor, addition);
end
$migration$;

-- ── 3 ─────────────────────────────────────────────────────────────────────
drop policy if exists tenant_logos_select on storage.objects;
create policy tenant_logos_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'tenant-logos'
    and (storage.foldername(name))[1] = (select public.current_tenant_id())::text
  );

-- ── 4 ─────────────────────────────────────────────────────────────────────
drop policy if exists client_avatars_select on storage.objects;
drop policy if exists client_avatars_insert on storage.objects;
drop policy if exists client_avatars_update on storage.objects;
drop policy if exists client_avatars_delete on storage.objects;

-- ── 5 ─────────────────────────────────────────────────────────────────────
do $migration$
declare
  fn regprocedure := 'public.sms_send_manual(uuid,uuid,text,text,text,text)'::regprocedure;
  def text;
  anchor text := $old$  -- С карточки клиента (без записи) — по блоку «SMS: Меняет» (02.10). SMS
  -- из записи держит своё право календаря.
  if not is_owner
     and p_appointment_id is null
     and not (v_client = any(public.access_block_client_ids('clients.sms', 'write'))) then
    raise exception 'sms:rights' using errcode = '42501';
  end if;$old$;
  replacement text := $new$  -- «SMS: Меняет» — на КАЖДУЮ отправку не владельца (аудит 03.10): из записи
  -- SMS шло по одному праву видеть календарь, и партнёр со «SMS: Скрыт» тратил
  -- баланс владельца из любой записи команды.
  if not is_owner
     and not (v_client = any(public.access_block_client_ids('clients.sms', 'write'))) then
    raise exception 'sms:rights' using errcode = '42501';
  end if;$new$;
begin
  if (select md5(prosrc) from pg_proc where oid = fn) <> '0701aae0c1066eeb25ce002d0aac1243' then
    raise exception 'sms_send_manual изменилась после разбора 03.10 — перечитать тело перед правкой';
  end if;
  def := pg_get_functiondef(fn);
  if (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'проверка «SMS: Меняет» не найдена ровно один раз';
  end if;
  execute replace(def, anchor, replacement);
end
$migration$;

-- ── 6 ─────────────────────────────────────────────────────────────────────
do $migration$
declare
  fn regprocedure := 'public.member_appointment_update(uuid,jsonb)'::regprocedure;
  def text;
  anchor text := $old$  if p_patch ? 'status'
     and (p_patch ->> 'status') not in ('scheduled', 'in_progress', 'completed', 'cancelled') then
    raise exception 'unsupported appointment status' using errcode = '22023';
  end if;$old$;
  addition text := $new$  if p_patch ? 'status'
     and (p_patch ->> 'status') not in ('scheduled', 'in_progress', 'completed', 'cancelled') then
    raise exception 'unsupported appointment status' using errcode = '22023';
  end if;

  -- ОТМЕНА ЗАПИСИ С ДЕНЬГАМИ — ЭТО ВОЗВРАТ (аудит 03.10): сверка финансов на
  -- отмене пишет возврат всех денег записи. Без права «Оплата в записи:
  -- Меняет» отмена такой записи не проходит.
  if p_patch ? 'status'
     and (p_patch ->> 'status') = 'cancelled'
     and a.status is distinct from 'cancelled'
     and (
       coalesce(a.prepaid_amount, 0) > 0
       or coalesce(a.paid_amount, 0) > 0
       or a.payment_status in ('paid', 'partial')
       or exists (
         select 1 from public.finance_transactions t
          where t.appointment_id = a.id and t.tenant_id = a.tenant_id and t.type = 'income'
       )
     )
     and public.member_can('record.payment', 'write', a.team_id) is not true then
    raise exception 'access:block:record.payment' using errcode = '42501';
  end if;$new$;
begin
  if (select md5(prosrc) from pg_proc where oid = fn) <> 'c532faf6ea0d0b59796ebef0ce93b02b' then
    raise exception 'member_appointment_update изменилась после разбора 03.10 — перечитать тело перед правкой';
  end if;
  def := pg_get_functiondef(fn);
  if (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'проверка статуса не найдена ровно один раз';
  end if;
  execute replace(def, anchor, addition);
end
$migration$;
