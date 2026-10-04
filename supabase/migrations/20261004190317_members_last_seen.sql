-- «БЫЛ В ПРИЛОЖЕНИИ» НА СТРАНИЦЕ ПАРТНЁРА (владелец 04.10, мозговой штурм
-- страницы партнёра: «да, давай делай»). Под почтой — живой ли аккаунт:
-- когда человек последний раз был в приложении. `last_sign_in_at` меняется
-- только при входе паролем или кодом, а приложение месяцами живёт на одном
-- входе — поэтому берётся и последнее обновление его сессий (токен
-- обновляется, пока приложение открыто).
--
-- `list_members` читают только те, кому открыт «Партнёры» (проверка в начале
-- функции не меняется). Тело — из живого `pg_get_functiondef`.

set local lock_timeout = '5s';

do $patch$
declare
  def text;
  needle constant text := E'''joined_at'', tm.joined_at\n';
  replacement constant text := E'''joined_at'', tm.joined_at,\n               ''last_seen_at'', greatest(\n                 u.last_sign_in_at,\n                 (select max(greatest(s.refreshed_at::timestamptz, s.updated_at))\n                    from auth.sessions s\n                   where s.user_id = tm.user_id)\n               )\n';
begin
  def := pg_get_functiondef('public.list_members(text)'::regprocedure);
  if (length(def) - length(replace(def, needle, ''))) / length(needle) <> 1 then
    raise exception 'list_members: joined_at не найден ровно один раз';
  end if;
  execute replace(def, needle, replacement);
end
$patch$;

do $guard$
begin
  if position('last_seen_at' in (select prosrc from pg_proc
       where oid = 'public.list_members(text)'::regprocedure)) = 0 then
    raise exception 'сторож: list_members не отдаёт last_seen_at';
  end if;
end
$guard$;
