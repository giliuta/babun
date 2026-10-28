-- ОЦЕНКА МАСТЕРА: ДВЕ АНОНИМНЫЕ ДВЕРИ ЗАКРЫТЫ (пачка 6, С3).
--
-- `lookup_rating_token` и `submit_rating` есть только в живой базе (в
-- `migrations/` их нет), приложение и функции-обработчики их не зовут, а роль
-- anon исполняла обе: по токену первая отдавала внутренние id компании,
-- мастера и записи. Страницы оценки нет — двери закрываются целиком, тела не
-- трогаются: если страница появится, она откроет их своей миграцией.

revoke execute on function public.lookup_rating_token(text) from public, anon, authenticated;
revoke execute on function public.submit_rating(text, integer, text) from public, anon, authenticated;

do $guard$
begin
  if has_function_privilege('anon', 'public.lookup_rating_token(text)', 'execute')
     or has_function_privilege('authenticated', 'public.lookup_rating_token(text)', 'execute')
     or has_function_privilege('anon', 'public.submit_rating(text, integer, text)', 'execute')
     or has_function_privilege('authenticated', 'public.submit_rating(text, integer, text)', 'execute') then
    raise exception 'двери оценки мастера снова открыты снаружи';
  end if;
end;
$guard$;
