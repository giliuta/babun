-- БЕЗ ТАРИФА — БЕЗ SMS (владелец 02.10: «да, закрывай тоже SMS»).
--
-- SMS открываются с тарифа «Соло» (01.10). До сих пор без тарифа ничего не
-- мешало слать: вручную из записи и карточки клиента, рассылкой по списку,
-- и автоматически по шаблонам команды для записей, заведённых ещё на
-- тарифе.
--
-- Сторож — на самой очереди `sms_messages`, куда пишут все три дороги
-- (`sms_send_manual`, `sms_send_bulk`, `sms_enqueue`):
--   • человек отправляет сам (есть вход) — отказ словами, hint `plan:sms`;
--   • автоматическое (cron, без входа) — сообщение просто не встаёт в
--     очередь: `sms_enqueue` пишет `returning id into inserted` и при
--     пропущенной вставке отвечает «не поставлено», как на любой другой
--     отказ шаблона.
-- Баланс, история, шаблоны и пополнение не задеты — их держат свои двери.

create or replace function public.sms_messages_tier_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if public.tenant_effective_plan(new.tenant_id) is distinct from 'free' then
    return new;
  end if;
  if auth.uid() is not null then
    raise exception 'SMS — в тарифах Соло, Про и Макс'
      using errcode = 'P0001', hint = 'plan:sms';
  end if;
  -- Автоматическое без тарифа — не ставим в очередь.
  return null;
end;
$function$;

revoke execute on function public.sms_messages_tier_guard() from public, anon;

drop trigger if exists sms_messages_tier_guard on public.sms_messages;
create trigger sms_messages_tier_guard
  before insert on public.sms_messages
  for each row execute function public.sms_messages_tier_guard();
