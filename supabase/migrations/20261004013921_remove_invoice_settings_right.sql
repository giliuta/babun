-- СТРАНИЦА «ИНВОЙСЫ» В ШЕСТЕРЁНКЕ «ФИНАНСОВ» УДАЛЕНА (владелец 2026-10-03:
-- «давай удалим полностью всё по поводу инвойса — страницу инвойса в
-- настройках, в шестерёнке; срок оплаты запоминает то, что выбирали перед
-- этим; если инвойсов ещё не было — 30 дней»).
--
-- Право `finance.settings_invoices` (строка шестерёнки «Инвойсы», миграция
-- 20261003235500) уходит из реестра. На 03.10 у него не было ни одной
-- выставленной строки, шаблона и приглашения (сверено); чистка ниже — на
-- случай, если они появятся до наката.
--
-- `current_tenant_profile_safe` отдавал партнёру колонки бланка
-- (`tenants.invoice_*`) по этому праву ИЛИ по праву выставлять документы.
-- Остаётся только второе: тому, кто выставляет, строки и приписка компании
-- нужны для его нового счёта. Тело — из живого `pg_get_functiondef`, меняется
-- одно условие.

set local lock_timeout = '5s';

delete from public.member_access where block = 'finance.settings_invoices';

update public.invitations i
   set access_changes = coalesce((
     select jsonb_agg(change)
       from jsonb_array_elements(i.access_changes) as change
      where change->>'block' is distinct from 'finance.settings_invoices'
   ), '[]'::jsonb)
 where jsonb_typeof(i.access_changes) = 'array'
   and exists (
     select 1 from jsonb_array_elements(i.access_changes) as change
      where change->>'block' = 'finance.settings_invoices'
   );

update public.access_templates
   set levels = levels - 'finance.settings_invoices'
 where levels ? 'finance.settings_invoices';

delete from public.access_blocks where key = 'finance.settings_invoices';

do $profile$
declare
  def text;
  needle constant text := E'when public.access_company(''finance.settings_invoices'', ''read'')\n          or cardinality(';
  replacement constant text := 'when cardinality(';
begin
  def := pg_get_functiondef('public.current_tenant_profile_safe()'::regprocedure);
  if (length(def) - length(replace(def, needle, ''))) / length(needle) <> 1 then
    raise exception 'current_tenant_profile_safe: invoices right check not found exactly once';
  end if;
  execute replace(def, needle, replacement);
end
$profile$;

do $guard$
begin
  if exists (select 1 from public.access_blocks where key = 'finance.settings_invoices') then
    raise exception 'сторож: право «Инвойсы» осталось в реестре';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosrc like '%settings_invoices%'
  ) then
    raise exception 'сторож: функция всё ещё спрашивает право «Инвойсы»';
  end if;
  if position('finance.documents' in (
       select prosrc from pg_proc where oid = 'public.current_tenant_profile_safe()'::regprocedure)) = 0 then
    raise exception 'сторож: профиль компании больше не отдаёт бланк тому, кто выставляет';
  end if;
end
$guard$;
