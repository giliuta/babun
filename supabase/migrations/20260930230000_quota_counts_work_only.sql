-- КВОТА «ЗАПИСИ В ЭТОМ МЕСЯЦЕ» СЧИТАЕТ ТОЛЬКО ЗАПИСИ КЛИЕНТОВ (аудит
-- 2026-09-29: «Записи в этом месяце 5», а аналитика за тот же месяц — 4:
-- в тариф считалось и личное событие).
--
-- Личное событие бесплатно в любом тарифе (20260912195000_free_plan_limits:
-- «личное событие бесплатно и остаётся бесплатным»), но месячная квота всё
-- равно его считала и тратила. Теперь событие квоту не тратит и в число не
-- входит; дата создания по-прежнему ставится сервером всем строкам.
--
-- Тело функции не переписывается руками: в живом определении дополняются
-- ровно два места.

do $$
declare
  def text;
  count_frag text := '     where appointment.tenant_id = new.tenant_id
       and appointment.created_at >= v_month_start';
  stamp_frag text := '    new.created_at := statement_timestamp();';
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'enforce_tenant_insert_quota';
  if def is null then
    raise exception 'функции enforce_tenant_insert_quota нет';
  end if;
  if (length(def) - length(replace(def, count_frag, ''))) / length(count_frag) <> 1 then
    raise exception 'условие счёта записей встречается не ровно один раз';
  end if;
  if (length(def) - length(replace(def, stamp_frag, ''))) / length(stamp_frag) <> 1 then
    raise exception 'штамп даты создания встречается не ровно один раз';
  end if;
  def := replace(def, count_frag, count_frag || '
       and appointment.kind = ''work''');
  def := replace(def, stamp_frag, stamp_frag || '
    -- Личное событие квоту не тратит (аудит 2026-09-29).
    if new.kind is distinct from ''work'' then
      return new;
    end if;');
  execute def;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_proc
     where proname = 'enforce_tenant_insert_quota'
       and prosrc like '%appointment.kind = ''work''%'
       and prosrc like '%new.kind is distinct from ''work''%'
  ) then
    raise exception 'квота записей всё ещё считает события';
  end if;
end
$$;
