-- ПРАВО «ШАБЛОНЫ SMS» КОМПАНИИ СНЯТО СО СТРАНИЦЫ ПРАВ (проверка доступа 04.10,
-- владелец: «проверь ещё раз, правильно ли всё сейчас в доступе»).
--
-- С 29.09 шаблоны SMS живут у каждой команды (шестерёнка календаря → SMS,
-- `sms_team_templates` / `sms_save_team_template`): пишет их только владелец,
-- читает любой участник команды — иначе партнёр не отправит SMS по шаблону.
-- Старое право компании `company.sms_templates` правило прежние шаблоны
-- компании (`read_sms_templates_safe` / `write_sms_templates_safe`), которые
-- приложение больше не зовёт. На карточке партнёра оно стояло отдельным
-- разделом «Компания → Шаблоны SMS» и ничем не управляло.
--
-- Право гасится (`live = false`), а не удаляется: строк прав и приглашений с
-- ним нет (сверено 04.10), старые функции остаются как были.

set local lock_timeout = '5s';

update public.access_blocks
   set live = false
 where key = 'company.sms_templates';

do $guard$
begin
  if exists (select 1 from public.access_blocks where key = 'company.sms_templates' and live) then
    raise exception 'сторож: «Шаблоны SMS» компании всё ещё живое право';
  end if;
  if exists (select 1 from public.member_access where block = 'company.sms_templates') then
    raise exception 'сторож: у кого-то выставлено снятое право «Шаблоны SMS»';
  end if;
end
$guard$;
