-- «УДАЛЁННЫЕ ЗАПИСИ» — ЯЩИК НА 30 ДНЕЙ, КАК «УДАЛЁННЫЕ ОПЕРАЦИИ».
--
-- Удалённая запись или событие 30 дней лежит в «Удалённых записях» (дверь —
-- шестерёнка календаря) и возвращается оттуда «Вернуть» той же строкой с тем
-- же id. «Удалить» в календаре перестаёт быть необратимым.
--
-- УСТРОЙСТВО — ЯЩИК, А НЕ ПОМЕТКА НА СТРОКЕ (тот же довод, что у операций,
-- миграция 20261003224700). Запись читают сетка, свободные слоты, напоминания,
-- SMS, история клиента, финансы дня, выгрузка, сервер в десятке функций;
-- пометка `deleted_at` обязала бы каждого не видеть помеченное, и одно
-- забытое место вернуло бы удалённый визит в чужое время. Поэтому запись
-- удаляется по-настоящему (все прежние сторожа и каскады отрабатывают), а её
-- снимок уходит в `deleted_appointments`.
--
--   1. В ЯЩИК — ТОЛЬКО ТО, ЧТО ЧЕЛОВЕК УДАЛИЛ САМ: `delete_appointment(p_id)`
--      ставит флаг транзакции `babun.appointment_trash`. Удаление календаря,
--      каскад компании и прочие стирания флага не ставят — их строки в ящик
--      не идут. Права — ровно сегодняшние: владелец и диспетчер удаляют под
--      политикой `appointments_delete`, сотрудник — дверью
--      `member_appointment_delete` (её проверки блоков и окна записей).
--      Запись с деньгами по-прежнему не удаляется:
--      `guard_appointment_history_delete` стоит раньше ящика по имени
--      (trg_g… < trg_t…) и отказывает до снимка.
--   2. СНИМОК ЦЕЛИКОМ. Строка записи (`to_jsonb`) и всё, что удаление уносит
--      или отвязывает:
--        • каскадом уходят — строки фото (`appointment_photos`), ссылка
--          клиента на подтверждение (`appointment_links`), токены оценки
--          мастера (`master_rating_tokens`): их строки лежат в снимке целиком;
--        • `on delete set null` отвязывает — SMS (`sms_messages`, `sms_logs`),
--          оценки (`master_ratings`), файлы клиента (`client_attachments`):
--          в снимке лежат их id, «Вернуть» привязывает их обратно.
--      Деньги (операции, чеки, инвойсы) сюда не попадают никогда: запись с
--      ними не удаляется вовсе (пункт 1).
--   3. СЕРИЯ СОБЫТИЙ — ОДНА СТРОКА. Повторы не хранятся: их рисует
--      `expand-repeat` из правила `event_repeat` первой строки. Снимок этой
--      строки и есть вся серия, «Вернуть» возвращает её целиком.
--   4. «ВЕРНУТЬ» (`restore_deleted_appointment`) — обычной дорогой вставки:
--      владелец и диспетчер — под политикой `appointments_insert` и всеми
--      сторожами вставки (тариф, квота, автор события, чужие ссылки);
--      сотрудник — дверью `member_appointment_restore` с теми же проверками,
--      что у его удаления. Ссылки, исчезнувшие за время в ящике, ведут себя
--      как у живой записи (`on delete set null`): клиент, мастер, счёт
--      оплаты, автор. Календаря нет — запись некуда вернуть, отказ
--      (`appointment:team_deleted`). Событие возвращает только его автор:
--      сервер не пускает событие с чужим автором (`enforce_appointment_event_scope`).
--      Фото, ссылки, токены и отвязанные строки возвращает триггер ящика
--      (definer): права на них у звонящего могут быть уже, чем у записи, а
--      вернуть надо ровно то, что ушло вместе с ней.
--      Возвращённая запись — не новая для клиента: SMS «запись создана» на
--      вставке ящика не уходит (флаг `babun.appointment_restore` в
--      `appointments_sms_trigger`).
--   5. ВИДИТ ЯЩИК: владелец — всё в компании; остальные — то, что удалили
--      сами, и только пока у них есть право удалять в этом календаре (доступ
--      сняли — снимок ушёл из виду вместе с ним). «Удалить насовсем» — RLS
--      delete с теми же условиями. Окно записей сотрудника
--      (`member_record_hidden`) проверяет его дверь «Вернуть»: в политике
--      помощник недоступен роли `authenticated`.
--   5.1 ЯЩИК — У КОМАНДЫ (`team_id not null`, как у всего в компании,
--      `team-scope-contract.test.ts`). Личное событие без календаря в ящик
--      не идёт и удаляется насовсем, как раньше; приложение для него
--      оставляет прежний вопрос «Действие необратимо». На 16.10 таких строк
--      в базе ноль.
--   6. ФАЙЛЫ ФОТО. Пока запись в ящике, блобы в бакете `appointment-photos`
--      живут (приложение больше не стирает их при удалении), а «сиротская»
--      ветка политики удаления блоба теперь не трогает файлы записи из
--      ящика. «Удалить насовсем» стирает блобы из приложения (Storage API,
--      ветка «записи нет» политики `storage_appointment_photos_delete`).
--      Ночная очистка их НЕ стирает: SQL не удаляет файлы хранилища
--      (`storage.protect_delete`, а строка `storage.objects` без Storage API
--      оставила бы сам файл в бакете). Остаток — сироты, их находит запрос
--      «объект бакета, чьей записи нет ни в `appointments`, ни в
--      `deleted_appointments`»; стирать их — дело edge-функции с ключом
--      сервиса (уборщик STORY-049a), как и сирот от сбоев загрузки.
--   7. Через 30 дней снимок стирает `purge_deleted_appointments()` (pg_cron,
--      03:57 — после клиентов 03:17, регистраций 03:27, счетов 03:37 и
--      операций 03:47).
--
-- Тела `appointments_sms_trigger` и `current_user_can_delete_appointment_blob`
-- — с живой базы (pg_get_functiondef 16.10, md5(prosrc) cb133f59… и
-- 2718fa46…), изменены только помеченные строки; права исполнения
-- `create or replace` не трогает.

set local lock_timeout = '5s';

-- ─── 1. Ящик ───

create table public.deleted_appointments (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  team_id text not null,
  kind text not null,
  created_by uuid,
  appointment jsonb not null,
  dependents jsonb not null default '{}'::jsonb,
  deleted_by uuid references auth.users(id) on delete set null,
  deleted_at timestamptz not null default now(),
  purge_at timestamptz not null
);

comment on table public.deleted_appointments is
  '«Удалённые записи»: снимок удалённой записи или события (to_jsonb строки appointments + зависимые строки), 30 дней до стирания.';
comment on column public.deleted_appointments.appointment is
  'Строка appointments на момент удаления; «Вернуть» вставляет её обратно с тем же id.';
comment on column public.deleted_appointments.dependents is
  'photos / links / rating_tokens — строки, ушедшие каскадом; sms_messages / sms_logs / master_ratings / client_attachments — id строк, отвязанных on delete set null.';

create index deleted_appointments_team_idx
  on public.deleted_appointments (tenant_id, team_id, deleted_at desc);
create index deleted_appointments_purge_idx
  on public.deleted_appointments (purge_at);

alter table public.deleted_appointments enable row level security;

-- Пишет в ящик только триггер (definer). Снаружи — чтение и «удалить
-- насовсем», и то по политикам ниже.
revoke all on table public.deleted_appointments from anon, authenticated;
grant select, delete on table public.deleted_appointments to authenticated;

-- Владелец — всё. Остальные — своё удалённое и только
-- там, где и сейчас могут удалять: те же ветки, что у `appointments_delete`,
-- плюс блоки сотрудника из `member_appointment_delete`. Каждая ветка со
-- скалярным подзапросом: помощник прав считается раз на запрос.
create policy deleted_appointments_select on public.deleted_appointments
  for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.current_user_role()) = 'owner'
      or (
        deleted_by = (select auth.uid())
        and (kind = 'work' or created_by = (select auth.uid()))
        and (
          ((select public.current_user_role()) = 'dispatcher'
            and not (select public.current_user_has_calendar_grants()))
          or team_id in (select unnest(public.current_user_calendar_ids('edit_all')))
          or ((select public.current_user_role()) = 'master'
            and (
              (kind = 'work'
                and team_id in (select unnest(public.access_calendars('calendar.cancel', 'write'))))
              or (kind <> 'work'
                and team_id in (select unnest(public.access_calendars('calendar.events', 'write'))))
            ))
        )
      )
    )
  );

create policy deleted_appointments_delete on public.deleted_appointments
  for delete to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      (select public.current_user_role()) = 'owner'
      or (
        deleted_by = (select auth.uid())
        and (kind = 'work' or created_by = (select auth.uid()))
        and (
          ((select public.current_user_role()) = 'dispatcher'
            and not (select public.current_user_has_calendar_grants()))
          or team_id in (select unnest(public.current_user_calendar_ids('edit_all')))
          or ((select public.current_user_role()) = 'master'
            and (
              (kind = 'work'
                and team_id in (select unnest(public.access_calendars('calendar.cancel', 'write'))))
              or (kind <> 'work'
                and team_id in (select unnest(public.access_calendars('calendar.events', 'write'))))
            ))
        )
      )
    )
  );

-- ─── 2. Удаление в ящик ───

-- BEFORE DELETE: каскад ещё не прошёл — фото, ссылки и отвязываемые строки
-- видны. Любой отказ дальше (сторож, политика, каскад) откатывает и снимок.
create function public.trash_deleted_appointment()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  -- Только «Удалить» из приложения (`delete_appointment`): удаление
  -- календаря, каскад компании и прочие стирания флага не ставят.
  if coalesce(current_setting('babun.appointment_trash', true), '') <> 'on' then
    return old;
  end if;
  -- Личное событие без календаря в ящик не идёт: у ящика, как у всего в
  -- компании, команда обязательна, а вернуть такое событие было бы некуда
  -- показать. Удаляется, как раньше, насовсем — приложение так и
  -- спрашивает («Действие необратимо»).
  if old.team_id is null then
    return old;
  end if;
  insert into public.deleted_appointments
    (id, tenant_id, team_id, kind, created_by, appointment, dependents,
     deleted_by, deleted_at, purge_at)
  values (
    old.id, old.tenant_id, old.team_id, old.kind, old.created_by, to_jsonb(old),
    jsonb_build_object(
      'photos', coalesce((
        select jsonb_agg(to_jsonb(p) order by p.sort_order, p.created_at)
          from public.appointment_photos p where p.appointment_id = old.id), '[]'::jsonb),
      'links', coalesce((
        select jsonb_agg(to_jsonb(l))
          from public.appointment_links l where l.appointment_id = old.id), '[]'::jsonb),
      'rating_tokens', coalesce((
        select jsonb_agg(to_jsonb(r))
          from public.master_rating_tokens r where r.appointment_id = old.id), '[]'::jsonb),
      'sms_messages', coalesce((
        select jsonb_agg(m.id) from public.sms_messages m where m.appointment_id = old.id), '[]'::jsonb),
      'sms_logs', coalesce((
        select jsonb_agg(s.id) from public.sms_logs s where s.appointment_id = old.id), '[]'::jsonb),
      'master_ratings', coalesce((
        select jsonb_agg(r.id) from public.master_ratings r where r.appointment_id = old.id), '[]'::jsonb),
      'client_attachments', coalesce((
        select jsonb_agg(c.id) from public.client_attachments c where c.appointment_id = old.id), '[]'::jsonb)
    ),
    auth.uid(), now(), now() + interval '30 days'
  );
  return old;
end;
$function$;

create trigger trg_trash_deleted_appointment
  before delete on public.appointments
  for each row execute function public.trash_deleted_appointment();

-- Права — сегодняшние: сотрудник удаляет своей дверью (блоки и окно записей
-- проверяет она), остальные — под политикой удаления. От лица звонящего.
create function public.delete_appointment(p_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $function$
declare
  removed uuid;
begin
  perform set_config('babun.appointment_trash', 'on', true);
  if public.current_user_role() = 'master' then
    -- Не нашла или нет права — дверь сама откажет.
    perform public.member_appointment_delete(p_id);
    removed := p_id;
  else
    delete from public.appointments
     where id = p_id
       and tenant_id = public.current_tenant_id()
    returning id into removed;
  end if;
  perform set_config('babun.appointment_trash', 'off', true);
  if removed is null then
    raise exception 'Запись недоступна или уже удалена'
      using errcode = 'P0002', hint = 'appointment:not_found';
  end if;
  return removed;
end;
$function$;

-- ─── 3. «Вернуть» ───

-- Снимок, готовый к вставке: исчезнувшие ссылки — пусто, как сделал бы
-- `on delete set null` с живой записью. Проверяет СУЩЕСТВОВАНИЕ, а не
-- видимость: под RLS партнёра чужой клиент выглядел бы удалённым и молча
-- слетел бы с записи. Узнать так можно только про id, которые звонящий и так
-- держит в своём снимке.
create function public.deleted_appointment_ready(p_appointment jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  ready jsonb := p_appointment;
  tenant uuid := (p_appointment->>'tenant_id')::uuid;
begin
  if exists (select 1 from public.appointments a where a.id = (p_appointment->>'id')::uuid) then
    raise exception 'Эта запись уже в календаре'
      using errcode = '23505', hint = 'appointment:already_back';
  end if;
  if ready->>'team_id' is not null and not exists (
    select 1 from public.teams t where t.tenant_id = tenant and t.id = ready->>'team_id'
  ) then
    raise exception 'Календаря этой записи больше нет — вернуть её некуда'
      using errcode = '23503', hint = 'appointment:team_deleted';
  end if;
  if ready->>'client_id' is not null and not exists (
    select 1 from public.clients c
     where c.tenant_id = tenant and c.id = (ready->>'client_id')::uuid
  ) then
    ready := jsonb_set(ready, '{client_id}', 'null');
  end if;
  if ready->>'master_id' is not null and not exists (
    select 1 from public.masters m where m.tenant_id = tenant and m.id = ready->>'master_id'
  ) then
    ready := jsonb_set(ready, '{master_id}', 'null');
  end if;
  if ready->>'payment_account_id' is not null and not exists (
    select 1 from public.accounts a where a.id = (ready->>'payment_account_id')::uuid
  ) then
    ready := jsonb_set(ready, '{payment_account_id}', 'null');
  end if;
  -- Автор ушёл из системы: у рабочей записи автором станет вернувший
  -- (`set_appointment_created_by`); событие без автора не вернёт никто.
  if ready->>'created_by' is not null and not exists (
    select 1 from auth.users u where u.id = (ready->>'created_by')::uuid
  ) then
    ready := jsonb_set(ready, '{created_by}', 'null');
  end if;
  return ready;
end;
$function$;

-- Сотрудник: вставлять запись напрямую ему не даёт RLS, поэтому «Вернуть» —
-- дверью, как и удаление. Проверки — те же, что у `member_appointment_delete`;
-- содержимое берётся из ящика, а не от звонящего.
create function public.member_appointment_restore(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  trashed public.deleted_appointments%rowtype;
begin
  if auth.uid() is null or public.current_user_role() is distinct from 'master' then
    raise exception 'only an employee can use this appointment restore' using errcode = '42501';
  end if;
  select * into trashed
    from public.deleted_appointments d
   where d.id = p_id
     and d.tenant_id = public.current_tenant_id()
     and d.deleted_by = auth.uid()
   for update;
  if not found
     or public.member_record_hidden(trashed.kind, trashed.team_id, trashed.appointment->>'date') then
    raise exception 'Записи нет в «Удалённых»'
      using errcode = 'P0002', hint = 'appointment:not_in_trash';
  end if;
  if trashed.kind = 'work' then
    if not public.member_can('calendar.cancel', 'write', trashed.team_id) then
      raise exception 'access:block:calendar.cancel' using errcode = '42501';
    end if;
  elsif trashed.created_by is distinct from auth.uid()
     or not public.member_can('calendar.events', 'write', trashed.team_id) then
    raise exception 'access:block:calendar.events' using errcode = '42501';
  end if;
  perform set_config('babun.appointment_restore', 'on', true);
  insert into public.appointments
  select (jsonb_populate_record(
    null::public.appointments,
    public.deleted_appointment_ready(trashed.appointment)
  )).*;
  perform set_config('babun.appointment_restore', 'off', true);
  -- Снимок уходит из ящика — триггер ящика возвращает фото и связи.
  delete from public.deleted_appointments where id = p_id;
  return p_id;
end;
$function$;

create function public.restore_deleted_appointment(p_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $function$
declare
  trashed public.deleted_appointments%rowtype;
begin
  if public.current_user_role() = 'master' then
    return public.member_appointment_restore(p_id);
  end if;
  -- Видит ли звонящий снимок — решает RLS ящика.
  select * into trashed from public.deleted_appointments where id = p_id;
  if not found then
    raise exception 'Записи нет в «Удалённых»'
      using errcode = 'P0002', hint = 'appointment:not_in_trash';
  end if;
  if trashed.kind <> 'work' and trashed.created_by is distinct from auth.uid() then
    raise exception 'Событие может вернуть только его автор'
      using errcode = '42501', hint = 'appointment:not_author';
  end if;
  -- Вставка — под политикой создания записи и всеми сторожами вставки. Две
  -- «Вернуть» разом не вставят запись дважды: вторая упрётся в ключ первой.
  perform set_config('babun.appointment_restore', 'on', true);
  insert into public.appointments
  select (jsonb_populate_record(
    null::public.appointments,
    public.deleted_appointment_ready(trashed.appointment)
  )).*;
  perform set_config('babun.appointment_restore', 'off', true);
  -- Снимок забирается из ящика под RLS звонящего (права UPDATE на ящик у
  -- приложения нет); триггер ящика возвращает фото и связи.
  delete from public.deleted_appointments where id = p_id;
  if not found then
    raise exception 'Записи нет в «Удалённых»'
      using errcode = 'P0002', hint = 'appointment:not_in_trash';
  end if;
  return p_id;
end;
$function$;

-- Снимок ушёл из ящика, а запись с этим id в календаре — значит, это
-- «Вернуть»: фото, ссылка клиента и токены оценки встают обратно, SMS,
-- оценки и файлы клиента снова привязываются. Записи нет — это «Удалить
-- насовсем» или ночная очистка, возвращать нечего. Definer: у вернувшего
-- может не быть права на файлы записи, а вернуть надо ровно то, что ушло
-- вместе с ней.
create function public.deleted_appointment_bring_back()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not exists (
    select 1 from public.appointments a where a.id = old.id and a.tenant_id = old.tenant_id
  ) then
    return old;
  end if;
  insert into public.appointment_photos
  select (jsonb_populate_record(null::public.appointment_photos, p)).*
    from jsonb_array_elements(coalesce(old.dependents->'photos', '[]'::jsonb)) p
  on conflict (id) do nothing;
  insert into public.appointment_links
  select (jsonb_populate_record(null::public.appointment_links, l)).*
    from jsonb_array_elements(coalesce(old.dependents->'links', '[]'::jsonb)) l
  on conflict do nothing;
  insert into public.master_rating_tokens
  select (jsonb_populate_record(null::public.master_rating_tokens, r)).*
    from jsonb_array_elements(coalesce(old.dependents->'rating_tokens', '[]'::jsonb)) r
  on conflict do nothing;
  update public.sms_messages set appointment_id = old.id
   where tenant_id = old.tenant_id and appointment_id is null
     and id in (select (jsonb_array_elements_text(coalesce(old.dependents->'sms_messages', '[]'::jsonb)))::uuid);
  update public.sms_logs set appointment_id = old.id
   where tenant_id = old.tenant_id and appointment_id is null
     and id in (select (jsonb_array_elements_text(coalesce(old.dependents->'sms_logs', '[]'::jsonb)))::uuid);
  update public.master_ratings set appointment_id = old.id
   where tenant_id = old.tenant_id and appointment_id is null
     and id in (select (jsonb_array_elements_text(coalesce(old.dependents->'master_ratings', '[]'::jsonb)))::uuid);
  update public.client_attachments set appointment_id = old.id
   where tenant_id = old.tenant_id and appointment_id is null
     and id in (select (jsonb_array_elements_text(coalesce(old.dependents->'client_attachments', '[]'::jsonb)))::uuid);
  return old;
end;
$function$;

create trigger trg_deleted_appointment_bring_back
  after delete on public.deleted_appointments
  for each row execute function public.deleted_appointment_bring_back();

-- Возвращённая запись — не новая для клиента: «запись создана» второй раз не
-- уходит. Флаг подделать может любой — но так он лишь заглушит SMS своей же
-- вставки.
create or replace function public.appointments_sms_trigger()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  queued boolean := false;
  t record;
  end_at timestamptz;
begin
  begin
    if tg_op = 'INSERT' then
      -- «Вернуть» из «Удалённых записей» — не новая запись (16.10).
      if new.kind = 'work' and new.status = 'scheduled'
         and coalesce(current_setting('babun.appointment_restore', true), '') <> 'on' then
        queued := public.sms_enqueue_trigger(new.id, 'created');
      end if;
    elsif new.status = 'cancelled' and old.status is distinct from 'cancelled' then
      -- Отмена: неотправленное «до визита» уже ни к чему.
      delete from public.sms_messages
       where appointment_id = new.id and status = 'queued'
         and trigger_type in ('new_appointment', 'reminder', 'reschedule');
      queued := public.sms_enqueue_trigger(new.id, 'cancelled');
    elsif new.status = 'completed' and old.status is distinct from 'completed' then
      end_at := public.sms_appointment_end(new.id);
      for t in
        select tpl.id, tpl.hours
          from public.sms_team_templates tpl
         where tpl.tenant_id = new.tenant_id and tpl.team_id = new.team_id
           and tpl.enabled and tpl.trigger = 'after'
      loop
        -- Отметили выполненной через сутки после срока — «спасибо» уже не к месту.
        if end_at is not null and end_at + make_interval(hours => t.hours) > now() - interval '1 day' then
          if public.sms_enqueue(new.id, t.id, end_at + make_interval(hours => t.hours)) then
            queued := true;
          end if;
        end if;
      end loop;
    elsif new.status = 'scheduled'
      and (new.date is distinct from old.date or new.time_start is distinct from old.time_start) then
      -- Перенос: напоминания о прежнем времени не нужны, новые поставит
      -- расписание. Неотправленное подтверждение или перенос уйдут с новой
      -- датой сами (текст собирается при отправке) — второй не нужен.
      delete from public.sms_messages
       where appointment_id = new.id and status = 'queued' and trigger_type = 'reminder';
      if not exists (
        select 1 from public.sms_messages m
         where m.appointment_id = new.id and m.status = 'queued'
           and m.trigger_type in ('new_appointment', 'reschedule')
      ) then
        queued := public.sms_enqueue_trigger(new.id, 'rescheduled');
      end if;
    end if;
    if queued then
      perform public.sms_wake();
    end if;
  exception when others then
    -- SMS не имеет права уронить запись.
    raise warning 'appointments_sms_trigger: %', sqlerrm;
  end;
  return null;
end;
$function$;

-- ─── 4. Файлы записи в ящике ───

-- «Записи нет» больше не значит «сирота»: запись может лежать в ящике, и её
-- фото вернутся вместе с ней. Сиротой блоб становится, когда записи нет и в
-- ящике.
create or replace function public.current_user_can_delete_appointment_blob(p_appointment_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select public.current_user_can_mutate_appointment_photo(p_appointment_id)
      or (
        public.current_user_role() in ('owner', 'dispatcher')
        and p_appointment_id is not null
        and not exists (
          select 1 from public.appointments a where a.id = p_appointment_id
        )
        -- Запись в «Удалённых записях» — её фото ещё понадобятся (16.10).
        and not exists (
          select 1 from public.deleted_appointments d where d.id = p_appointment_id
        )
      )
$function$;

-- ─── 5. Ночная очистка ───

create function public.purge_deleted_appointments()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  removed integer;
begin
  delete from public.deleted_appointments where purge_at <= now();
  get diagnostics removed = row_count;
  return removed;
end;
$function$;

comment on function public.purge_deleted_appointments() is
  'Ночная очистка «Удалённых записей»: стирает снимки, чей срок вышел. Файлы фото в бакете не трогает (их стирает только Storage API). Только для pg_cron.';

select cron.schedule(
  'purge-deleted-appointments',
  '57 3 * * *',
  $$select public.purge_deleted_appointments();$$
);

-- ─── 6. Права исполнения ───

revoke all on function public.trash_deleted_appointment() from public, anon, authenticated;
revoke all on function public.deleted_appointment_bring_back() from public, anon, authenticated;
revoke all on function public.purge_deleted_appointments() from public, anon, authenticated;
revoke all on function public.delete_appointment(uuid) from public, anon;
revoke all on function public.restore_deleted_appointment(uuid) from public, anon;
revoke all on function public.member_appointment_restore(uuid) from public, anon;
revoke all on function public.deleted_appointment_ready(jsonb) from public, anon;
grant execute on function public.delete_appointment(uuid) to authenticated;
grant execute on function public.restore_deleted_appointment(uuid) to authenticated;
-- «Вернуть» исполняется от лица звонящего и зовёт обе двери сам.
grant execute on function public.member_appointment_restore(uuid) to authenticated;
grant execute on function public.deleted_appointment_ready(jsonb) to authenticated;

-- ─── 7. Сторож ───

do $guard$
declare
  entry text;
begin
  foreach entry in array array[
    'public.trash_deleted_appointment()', 'public.deleted_appointment_bring_back()',
    'public.purge_deleted_appointments()'
  ] loop
    if has_function_privilege('anon', entry, 'execute')
       or has_function_privilege('authenticated', entry, 'execute') then
      raise exception 'сторож: служебная % исполнима снаружи', entry;
    end if;
  end loop;

  foreach entry in array array[
    'public.delete_appointment(uuid)', 'public.restore_deleted_appointment(uuid)',
    'public.member_appointment_restore(uuid)', 'public.deleted_appointment_ready(jsonb)'
  ] loop
    if has_function_privilege('anon', entry, 'execute') then
      raise exception 'сторож: % исполнима без входа', entry;
    end if;
    if not has_function_privilege('authenticated', entry, 'execute') then
      raise exception 'сторож: % закрыта для приложения', entry;
    end if;
  end loop;

  if has_table_privilege('anon', 'public.deleted_appointments', 'select')
     or has_table_privilege('authenticated', 'public.deleted_appointments', 'insert')
     or has_table_privilege('authenticated', 'public.deleted_appointments', 'update') then
    raise exception 'сторож: ящик записей пишется снаружи';
  end if;

  -- Ящик — до удаления (BEFORE = бит 2), иначе каскад уже унёс фото; и
  -- после сторожа истории денег по имени.
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.appointments'::regclass
       and tgname = 'trg_trash_deleted_appointment'
       and tgenabled = 'O'
       and tgtype & 2 = 2
  ) or 'trg_trash_deleted_appointment' <= 'trg_guard_appointment_history_delete' then
    raise exception 'сторож: триггер «Удалённых записей» не стоит до удаления';
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.deleted_appointments'::regclass
       and tgname = 'trg_deleted_appointment_bring_back'
       and tgenabled = 'O'
  ) then
    raise exception 'сторож: возврат фото и связей не включён';
  end if;

  if position('babun.appointment_restore' in (select prosrc from pg_proc where oid = 'public.appointments_sms_trigger()'::regprocedure)) = 0
     or position('deleted_appointments' in (select prosrc from pg_proc where oid = 'public.current_user_can_delete_appointment_blob(uuid)'::regprocedure)) = 0 then
    raise exception 'сторож: правки SMS и файлов не на месте';
  end if;

  if not exists (
    select 1 from cron.job
     where jobname = 'purge-deleted-appointments'
       and schedule = '57 3 * * *'
       and command = 'select public.purge_deleted_appointments();'
  ) then
    raise exception 'сторож: ночная очистка записей не запланирована';
  end if;
end
$guard$;
