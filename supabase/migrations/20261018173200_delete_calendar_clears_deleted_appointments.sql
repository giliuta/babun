-- УДАЛЕНИЕ КАЛЕНДАРЯ ЧИСТИТ ЕГО «УДАЛЁННЫЕ ЗАПИСИ».
--
-- `delete_calendar` стирал корзину операций своей команды («вернуть их
-- некуда — счета календаря уходят следом»), а ящик записей той же команды
-- оставлял. Снимки висели 30 дней с командой, которой нет: «Вернуть» на них
-- отвечает «Календаря этой записи больше нет», а ящик держит клиента, адрес и
-- цены удалённого календаря. Теперь они уходят тем же шагом, что и операции.
-- Записи самого календаря удаляются без флага ящика и в ящик не попадают.
--
-- Блобы фото этих снимков, как и фото живых записей календаря, остаются в
-- бакете сиротами — их стирает только Storage API (уборщик сирот).
--
-- Правка — точечная вставка в живое тело, якорь ровно один раз.

set local lock_timeout = '5s';

do $patch$
declare
  fn constant regprocedure := 'public.delete_calendar(text)'::regprocedure;
  body text := pg_get_functiondef(fn);
  anchor constant text := E'  delete from public.deleted_operations\n   where tenant_id = v_tenant and team_id = p_team_id;\n';
  replacement constant text := anchor
    || E'\n  -- «Удалённые записи» календаря: вернуть их тоже некуда.\n'
    || E'  delete from public.deleted_appointments\n'
    || E'   where tenant_id = v_tenant and team_id = p_team_id;\n';
begin
  if (length(body) - length(replace(body, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'delete_calendar: якорь корзины операций не найден ровно один раз';
  end if;
  execute replace(body, anchor, replacement);
end
$patch$;

do $guard$
begin
  if position('delete from public.deleted_appointments' in (
       select prosrc from pg_proc where oid = 'public.delete_calendar(text)'::regprocedure)) = 0 then
    raise exception 'сторож: delete_calendar не чистит «Удалённые записи»';
  end if;
end
$guard$;
