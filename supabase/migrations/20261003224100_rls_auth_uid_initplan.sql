-- ПРАВИЛА ДОСТУПА: «КТО Я» — ОДИН РАЗ НА ЗАПРОС, А НЕ НА КАЖДУЮ СТРОКУ
-- (проверка системы 03.10, советник базы `auth_rls_initplan`).
--
-- В 16 правилах (записи, участники, файлы клиента, шаблоны событий,
-- подписки) голый `auth.uid()` стоял в построчной части условия: Postgres
-- пересчитывал его для каждой строки. Обёрнутый в скалярный подзапрос
-- `(select auth.uid())`, он считается один раз на запрос — смысл правила не
-- меняется ни на символ, меняется только план.
--
-- Правила переписываются из их ЖИВОГО текста (`pg_get_expr`), а не из
-- миграций: здесь меняется только обёртка, остальное — как в базе сейчас.
-- Уже обёрнутые вхождения не трогаются (без двойной обёртки).

set local lock_timeout = '5s';

do $$
declare
  r record;
  v_qual text;
  v_chk text;
  v_sql text;
  c_wrapped constant text := '( SELECT auth.uid() AS uid)';
  c_mark constant text := chr(1);
begin
  for r in
    select c.relname as tbl, p.polname,
           pg_get_expr(p.polqual, p.polrelid) as qual,
           pg_get_expr(p.polwithcheck, p.polrelid) as chk
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
  loop
    v_qual := r.qual;
    v_chk := r.chk;
    if v_qual is not null then
      v_qual := replace(replace(replace(v_qual, c_wrapped, c_mark), 'auth.uid()', c_wrapped), c_mark, c_wrapped);
    end if;
    if v_chk is not null then
      v_chk := replace(replace(replace(v_chk, c_wrapped, c_mark), 'auth.uid()', c_wrapped), c_mark, c_wrapped);
    end if;
    continue when v_qual is not distinct from r.qual and v_chk is not distinct from r.chk;
    v_sql := format('alter policy %I on public.%I', r.polname, r.tbl);
    if v_qual is not null then v_sql := v_sql || format(' using (%s)', v_qual); end if;
    if v_chk is not null then v_sql := v_sql || format(' with check (%s)', v_chk); end if;
    execute v_sql;
  end loop;
end;
$$;
