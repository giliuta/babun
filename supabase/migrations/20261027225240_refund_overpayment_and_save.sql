-- ВОЗВРАТ ПЕРЕПЛАТЫ И НОВЫЙ ИТОГ — ОДНОЙ ТРАНЗАКЦИЕЙ (аудит 035, dat/M-03).
--
-- Форма записи при итоге ниже полученного делает два запроса:
-- `refund_appointment_overpayment` (деньги возвращаются клиенту), потом
-- обычное сохранение итога. Сорвался второй (обрыв сети, «запись изменилась
-- на другом устройстве», права) — деньги уже вернули, а итог прежний: у записи
-- долг ровно на сумму возврата, в кассе возврат.
--
-- `refund_overpayment_and_save` делает оба шага в одной транзакции: отказ
-- сохранения откатывает и возврат. Та же дверь сохранения, что у формы:
--   • мастер — `member_appointment_update(p_patch)` (каждое поле своим правом);
--   • владелец и диспетчер — UPDATE строки под их RLS (`appointments_update`),
--     `p_patch` — колонки базы (`appointmentToUpdate`), неизвестная колонка —
--     отказ, а не молча выброшенное поле.
-- Проверка «запись не менялась» (`p_expected_updated_at`) — ДО возврата:
-- иначе деньги ушли бы по итогу, которого человек не видел.
--
-- SECURITY INVOKER: права решают RLS и двери, которые уже проверены
-- (`refund_appointment_overpayment` и `member_appointment_update` — сами
-- определители со своими проверками). Флаг `babun.member_write`, который
-- ставит возврат, возвращается к прежнему значению до UPDATE владельца —
-- иначе сторож колонок мастера (`appointments_master_column_guard`) счёл бы
-- прямую правку проверенной.
--
-- КЛИЕНТ (отдельный шаг, `book-form/book-save.ts`): вместо двух вызовов —
-- один `refund_overpayment_and_save` с тем же `requestId` и тем же патчем,
-- что ушёл бы в сохранение.

create or replace function public.refund_overpayment_and_save(
  p_appointment_id uuid,
  p_amount numeric,
  p_request_id uuid,
  p_patch jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
set search_path = public
as $function$
declare
  role_name text := public.current_user_role();
  stamp timestamptz;
  prev_flag text;
  set_list text;
  unknown text;
  saved public.appointments%rowtype;
begin
  if auth.uid() is null or role_name is null then
    raise exception 'Войдите в приложение, чтобы сохранить запись'
      using errcode = '42501', hint = 'access:not_member';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'Нет изменений записи' using errcode = '22023';
  end if;

  if role_name <> 'master' then
    select string_agg(k, ', ' order by k) into unknown
      from jsonb_object_keys(p_patch) k
     where k in ('id', 'tenant_id', 'created_at', 'created_by', 'updated_at')
        or not exists (
          select 1 from information_schema.columns c
           where c.table_schema = 'public' and c.table_name = 'appointments' and c.column_name = k
        );
    if unknown is not null then
      raise exception 'Это поле записи так не сохраняется: %', unknown using errcode = '22023';
    end if;
    if p_expected_updated_at is not null then
      select a.updated_at into stamp
        from public.appointments a
       where a.id = p_appointment_id
       for update;
      if not found then
        raise exception 'Этой записи больше нет — её удалили на другом устройстве'
          using errcode = 'P0002', hint = 'appointment:gone';
      end if;
      if stamp is distinct from p_expected_updated_at then
        raise exception 'Запись изменилась на другом устройстве — проверьте её и повторите'
          using errcode = '40001', hint = 'appointment:stale';
      end if;
    end if;
  end if;

  prev_flag := coalesce(current_setting('babun.member_write', true), '');
  perform public.refund_appointment_overpayment(p_appointment_id, p_amount, p_request_id);

  if role_name = 'master' then
    return public.member_appointment_update(p_appointment_id, p_patch);
  end if;

  perform set_config('babun.member_write', prev_flag, true);
  select string_agg(format('%I = r.%I', k, k), ', ') into set_list
    from jsonb_object_keys(p_patch) k;
  execute format(
    'update public.appointments t set %s
       from jsonb_populate_record(null::public.appointments, $1) r
      where t.id = $2
      returning t.*', set_list)
    into saved
    using p_patch, p_appointment_id;
  if saved.id is null then
    raise exception 'Запись не найдена или её правит только владелец'
      using errcode = '42501', hint = 'appointment:not_editable';
  end if;
  return to_jsonb(saved);
end;
$function$;

comment on function public.refund_overpayment_and_save(uuid, numeric, uuid, jsonb, timestamptz) is
  'Возврат переплаты клиенту и сохранение нового итога записи одной транзакцией: отказ сохранения откатывает возврат.';

revoke all on function public.refund_overpayment_and_save(uuid, numeric, uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.refund_overpayment_and_save(uuid, numeric, uuid, jsonb, timestamptz) to authenticated;
