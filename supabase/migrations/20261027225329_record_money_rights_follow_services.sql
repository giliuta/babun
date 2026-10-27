-- «СУММА» ТОЛЬКО ПРИ ОТКРЫТЫХ «УСЛУГАХ», «ОПЛАТА» — ПРИ ОТКРЫТОЙ «СУММЕ»
-- (аудит 035, cab/R-07).
--
-- Страница прав сбрасывает зависимые блоки, пока главный скрыт
-- (`master-draft/dependants.ts`: «Услуги» → «Сумма» → «Оплата»). Сервер
-- проверял блоки поодиночке: набор, сохранённый мимо экрана
-- (`set_member_access`, приглашение), — «Услуги: Скрыт», «Сумма: Меняет»,
-- «Оплата: Меняет» — давал менять сумму и принимать оплату записи, работ
-- которой человек не видит.
--
-- Правило держится там, где сервер отвечает «в каких календарях у человека
-- этот блок» — `access_calendars_of`; через неё идут все проверки сумм и
-- оплат (`current_user_can_pay_appointment`, `member_appointment_create/update`,
-- выдачи записей). Тот же приём, что уже стоит для «Записей клиентов»: без
-- главного блока зависимый не действует, какой бы уровень ни хранился.
-- Хранимые уровни не трогаются. На 27.10 у обоих партнёров боевой базы набор
-- согласован («Услуги: Видит», «Сумма» и «Оплата: Меняет») — их права не
-- меняются.
--
-- Тело правится по якорю в живом определении.

do $migration$
declare
  d text := pg_get_functiondef('public.access_calendars_of(uuid, uuid, text, text)'::regprocedure);
  anchor constant text := E'       or array_position(array[''read'', ''write''], public.access_records_level(p_tenant, p_user, mc.team_id)) is not null\n     );\n';
  replacement constant text := E'       or array_position(array[''read'', ''write''], public.access_records_level(p_tenant, p_user, mc.team_id)) is not null\n     )\n'
    || E'     -- «Сумма» и «Оплата» без открытых «Услуг» не действуют, «Оплата» — и без «Суммы».\n'
    || E'     and (\n'
    || E'       block_row.key not in (''record.amount'', ''record.payment'')\n'
    || E'       or coalesce(\n'
    || E'            (select d.level from public.member_access d\n'
    || E'              where d.tenant_id = mc.tenant_id and d.user_id = mc.user_id\n'
    || E'                and d.team_id = mc.team_id and d.block = ''record.services''),\n'
    || E'            (select b.levels[1] from public.access_blocks b where b.key = ''record.services'')\n'
    || E'          ) <> ''off''\n'
    || E'     )\n'
    || E'     and (\n'
    || E'       block_row.key <> ''record.payment''\n'
    || E'       or coalesce(\n'
    || E'            (select d.level from public.member_access d\n'
    || E'              where d.tenant_id = mc.tenant_id and d.user_id = mc.user_id\n'
    || E'                and d.team_id = mc.team_id and d.block = ''record.amount''),\n'
    || E'            (select b.levels[1] from public.access_blocks b where b.key = ''record.amount'')\n'
    || E'          ) <> ''off''\n'
    || E'     );\n';
begin
  if (length(d) - length(replace(d, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'access_calendars_of: якорь шлюза «Записей» не найден ровно один раз';
  end if;
  execute replace(d, anchor, replacement);
end;
$migration$;
