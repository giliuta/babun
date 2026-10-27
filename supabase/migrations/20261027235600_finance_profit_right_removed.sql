-- «ПРИБЫЛЬ» БОЛЬШЕ НЕ ОТДЕЛЬНОЕ ПРАВО (035, №111).
--
-- Прибыль — доход минус расход; своих строк в базе у неё нет, и сервер её
-- никогда не проверял (`enforced_by` блока — только экран). Приложение
-- показывает прибыль тому, кто видит и доходы, и расходы, а строку «Прибыль»
-- со страницы прав сняло. В реестре `access_blocks` остался `finance.profit`
-- и 5 выдач по нему в `member_access`: набор прав, сохранённый мимо экрана
-- (`set_member_access`, приглашение), принимал бы блок, которого нет.
--
-- Выдачи уходят вместе с блоком (`member_access.block` ссылается на реестр).

delete from public.member_access where block = 'finance.profit';
delete from public.access_blocks where key = 'finance.profit';

do $guard$
begin
  if exists (select 1 from public.access_blocks where key = 'finance.profit')
     or exists (select 1 from public.member_access where block = 'finance.profit') then
    raise exception 'finance.profit: блок или выдачи по нему остались';
  end if;
  if exists (select 1 from public.invitations where access_changes::text like '%finance.profit%') then
    raise exception 'finance.profit: приглашение всё ещё выдаёт снятый блок';
  end if;
end;
$guard$;
