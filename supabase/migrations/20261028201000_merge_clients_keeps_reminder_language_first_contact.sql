-- СЛИЯНИЕ ДУБЛЕЙ НЕ ТЕРЯЕТ «НАПОМНИТЬ», ЯЗЫК И ПЕРВЫЙ КОНТАКТ (035, «Страница клиентов», С9).
--
-- `merge_clients` (20261027234500) переносил в основную карточку то, что
-- присылал патч приложения, а три поля в него не попадали:
--   • `reminder_at` — «Напомнить» дубля пропадало, а сам дубль уходил в
--     «Удалённые клиенты» со своей датой: «Восстановить» воскрешало
--     напоминание о второй карточке того же человека;
--   • `language` — в домене приложения поля нет вовсе, патч его не несёт;
--   • `first_contact_date` — у дубля она бывает раньше (первая карточка
--     заведена раньше), и ранняя дата терялась.
-- Теперь сервер сам, в той же транзакции, после патча:
--   язык — дубля, если у основной пусто; первый контакт — более ранний из
--   двух; «Напомнить» — основной, а если у неё нет — дубля; у дубля дата
--   снимается. Напоминание на телефоне снимает и ставит приложение
--   (`use-merge-duplicate.ts`): уведомления локальные.
--
-- Правка — заменой по якорям в живом теле (как 20261028101000): тело
-- функции велико, а меняются две строки. Якорь не найден ровно один раз —
-- миграция падает, ничего не меняя.

do $migration$
declare
  d text := pg_get_functiondef('public.merge_clients(uuid, uuid, jsonb, uuid[], jsonb)'::regprocedure);
  a_trash constant text := E'  -- 7. Дубль — в «Удалённые клиенты». Визитов у него больше нет, поэтому\n';
  b_trash constant text :=
       E'  -- 6а. Поля, которых нет в патче приложения: язык (в домене телефона его\n'
    || E'  --     нет), первый контакт — более ранний, «Напомнить» — основной, а нет\n'
    || E'  --     у неё — дубля. Дата у дубля снимается ниже, в п. 7.\n'
    || E'  update public.clients c\n'
    || E'     set language = case\n'
    || E'           when nullif(btrim(coalesce(c.language, '''')), '''') is null then dup.language\n'
    || E'           else c.language\n'
    || E'         end,\n'
    || E'         first_contact_date = case\n'
    || E'           when dup.first_contact_date is not null\n'
    || E'            and (c.first_contact_date is null or dup.first_contact_date < c.first_contact_date)\n'
    || E'             then dup.first_contact_date\n'
    || E'           else c.first_contact_date\n'
    || E'         end,\n'
    || E'         reminder_at = coalesce(c.reminder_at, dup.reminder_at)\n'
    || E'   where c.id = p_primary and c.tenant_id = active_tenant\n'
    || E'     and (\n'
    || E'       (nullif(btrim(coalesce(c.language, '''')), '''') is null and nullif(btrim(coalesce(dup.language, '''')), '''') is not null)\n'
    || E'       or (dup.first_contact_date is not null\n'
    || E'           and (c.first_contact_date is null or dup.first_contact_date < c.first_contact_date))\n'
    || E'       or (c.reminder_at is null and dup.reminder_at is not null)\n'
    || E'     );\n'
    || E'\n'
    || a_trash;
  a_purge constant text :=
       E'     set deleted_at = now(),\n'
    || E'         purge_at = now() + interval ''30 days''\n'
    || E'   where id = p_duplicate and tenant_id = active_tenant;\n';
  b_purge constant text :=
       E'     set deleted_at = now(),\n'
    || E'         purge_at = now() + interval ''30 days'',\n'
    || E'         reminder_at = null\n'
    || E'   where id = p_duplicate and tenant_id = active_tenant;\n';
begin
  if (length(d) - length(replace(d, a_trash, ''))) / length(a_trash) <> 1 then
    raise exception 'merge_clients: якорь п. 7 не найден ровно один раз';
  end if;
  if (length(d) - length(replace(d, a_purge, ''))) / length(a_purge) <> 1 then
    raise exception 'merge_clients: якорь корзины дубля не найден ровно один раз';
  end if;
  execute replace(replace(d, a_trash, b_trash), a_purge, b_purge);
end;
$migration$;
