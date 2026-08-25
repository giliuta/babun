-- ПОРЯДОК СТРОК И МАРШРУТ ДЕНЕГ — РАЗНЫЕ ВЕЩИ.
--
-- ЧТО СЕЙЧАС НЕ ТАК.
--   1. `accounts.position` почти нигде не заполнен: на 2026-08-10 в проде у 8
--      счетов из 11 он равен нулю. Сортировка `order by position, …` при
--      равных значениях отдаётся планировщику, а тот волен вернуть строки в
--      любом порядке. На практике это значит, что список счетов у владельца на
--      телефоне и на планшете выглядит по-разному, и «первый счёт» — понятие
--      без определения.
--   2. Этот же `position` решает, КУДА УЙДУТ ДЕНЬГИ: оба серверных резолвера
--      берут первый счёт по позиции. То есть «подвинуть строку повыше, чтобы
--      удобнее читалось» и «перенаправить все карточные оплаты бригады» —
--      сегодня один и тот же жест. Владелец, поднявший «Карту Ани» просто для
--      удобства, молча переадресует оплаты бригады Юры. Это P0, который UI
--      порядка (перетаскивание) сделает вызываемым одним движением пальца.
--
-- ЧТО ДЕЛАЕТ ЭТА МИГРАЦИЯ.
--   Разводит две вещи по разным колонкам: `position` — это ЧТЕНИЕ (в каком
--   порядке строки лежат на экране), `is_primary` — это МАРШРУТ (куда по
--   умолчанию падают деньги бригады). После этого перетаскивание становится
--   безопасным жестом, а смена основной кассы — осознанным переключателем в
--   настройках счёта.

-- ─── 1. Бэкфилл position: плотная нумерация внутри бригады ───────────
--
-- Нумеруем внутри (tenant_id, brigade_id). У счетов компании brigade_id равен
-- NULL, и оконная функция считает такие строки ОДНОЙ группой — это ровно то,
-- что нужно: счета компании одного тенанта образуют один список.
--
-- Сортировка: `position, created_at, id`, а не голый `created_at`. Причина —
-- уже расставленный вручную порядок нельзя терять: там, где позиции разные,
-- миграция их только уплотняет, а `created_at` разруливает единственный
-- реальный случай поломки — группу, где все позиции нули. На проде оба порядка
-- совпадают, так что видимых перестановок не будет.
--
-- `is distinct from` в условии — чтобы повторный прогон не трогал ни одной
-- строки: иначе триггер accounts_set_updated_at бесплатно бы обновлял
-- updated_at у всех счетов при каждом применении.
with numbered as (
  select
    id,
    row_number() over (
      partition by tenant_id, brigade_id
      order by position, created_at, id
    ) - 1 as new_position
  from public.accounts
)
update public.accounts a
   set position = n.new_position
  from numbered n
 where n.id = a.id
   and a.position is distinct from n.new_position;

-- УНИКАЛЬНЫЙ ИНДЕКС НА (tenant_id, brigade_id, position) НЕ СОЗДАЁТСЯ, И ЭТО
-- ОСОЗНАННО. У счетов компании brigade_id = NULL, а обычная уникальность
-- считает NULL-ы различными: два счёта компании с position = 0 такой индекс
-- пропустил бы, то есть защищал бы ровно там, где защита не нужна (у бригад,
-- где brigade_id заполнен), и молчал бы там, где нужна. Лечится это через
-- `nulls not distinct`, но тогда индекс начнёт мешать самой обычной операции —
-- перестановке строк местами: любой обмен позициями двух счетов проходит через
-- промежуточное состояние с дублем, и без отложенного констрейнта (а у
-- уникального ИНДЕКСА его не бывает) перетаскивание пришлось бы писать через
-- временные отрицательные позиции. Порядок строк — вещь косметическая; дубль
-- позиции стоит стабильного тай-брейкера в сортировке (`position, name, id`),
-- а не ежедневной борьбы с индексом.

-- ─── 2. is_primary: куда по умолчанию падают деньги бригады ──────────
alter table public.accounts
  add column if not exists is_primary boolean not null default false;

comment on column public.accounts.is_primary is
  'Основной счёт бригады: куда по умолчанию падают деньги. Развязан с position — порядок строк это чтение, а не маршрут денег.';

-- `nulls not distinct` здесь обязателен по той же причине, по которой выше
-- отвергнут индекс на position: без него у КОМПАНИИ (brigade_id = NULL) можно
-- было бы завести сколько угодно «основных» счетов, и правило «один основной
-- на группу» действовало бы только для бригад. Промежуточных состояний, как
-- при перестановке, здесь не бывает: основной счёт всегда ровно один, смена
-- делается снятием флага и установкой нового в одной транзакции.
create unique index if not exists ux_accounts_primary_per_brigade
  on public.accounts (tenant_id, brigade_id) nulls not distinct
  where is_primary;

-- ─── 3. Бэкфилл is_primary ───────────────────────────────────────────
--
-- Основным становится первый счёт группы по тому же детерминированному
-- порядку (`position, created_at, id`) — то есть тот, который и сегодня
-- выигрывает у резолверов. Поведение при этом не меняется ни у кого: мы лишь
-- записываем сложившийся выбор явно, чтобы он перестал зависеть от порядка
-- строк.
--
-- Кандидаты берутся только среди активных счетов: закрытый счёт не может быть
-- кассой по умолчанию. Группы, где основной уже назначен (в том числе закрытым
-- счётом), не трогаются вовсе — поэтому повторный прогон ничего не делает и
-- уникальный индекс не может быть нарушен.
with candidates as (
  select
    a.id,
    row_number() over (
      partition by a.tenant_id, a.brigade_id
      order by a.position, a.created_at, a.id
    ) as rn
  from public.accounts a
  where a.is_active
    and not exists (
      select 1
        from public.accounts p
       where p.tenant_id = a.tenant_id
         and p.brigade_id is not distinct from a.brigade_id
         and p.is_primary
    )
)
update public.accounts a
   set is_primary = true
  from candidates c
 where c.id = a.id
   and c.rn = 1;

-- ЧТО ОСТАЁТСЯ КЛИЕНТУ (слайс С3, app/accounts/[id]/settings.tsx): при закрытии
-- счёта, помеченного основным, флаг надо снимать в той же мутации. Иначе
-- закрытый счёт продолжит занимать единственное место в уникальном индексе, и
-- попытка назначить основным другой счёт бригады упрётся в нарушение
-- уникальности вместо понятного отказа. Резолверы закрытый счёт и так не
-- выберут — они фильтруют по is_active, — так что деньги при этом не уезжают,
-- ломается только переключатель.

-- ─── 4. Резолверы: сначала основной, потом порядок, потом имя ────────
--
-- Оба места, где сервер выбирает счёт, сортируют одинаково:
--   (a.scope = 'team') desc  — своя касса бригады бьёт счёт компании
--                              (правило существующее, не трогаем);
--   a.is_primary desc        — НОВОЕ: явно назначенная касса бьёт порядок строк;
--   a.position, a.name, a.id — детерминированный хвост, чтобы при равных
--                              позициях ответ не зависел от планировщика.

-- Автопроводка по заявке, когда касса не выбрана явно (закрытие дня, импорт,
-- старые записи). Изменена ТОЛЬКО строка order by.
create or replace function public.resolve_appointment_finance_account(
  p_tenant_id uuid,
  p_team_id text,
  p_payment_method text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  account_id uuid;
  required_kind text;
begin
  if p_team_id is null or btrim(p_team_id) = '' then
    raise exception 'Укажите команду заявки перед оплатой';
  end if;
  if p_payment_method is null
     or p_payment_method not in ('cash', 'card', 'transfer', 'other') then
    raise exception 'Выберите способ оплаты заявки';
  end if;
  required_kind := case p_payment_method
    when 'cash' then 'cash'
    when 'card' then 'card'
    when 'transfer' then 'bank'
    else 'other'
  end;

  select a.id into account_id
    from public.accounts a
   where a.tenant_id = p_tenant_id
     and a.kind = required_kind
     and a.is_active = true
     and (
       (a.scope = 'team' and a.brigade_id = p_team_id)
       or (a.scope = 'company' and exists (
         select 1 from public.account_teams att
          where att.account_id = a.id and att.team_id = p_team_id
       ))
     )
   order by (a.scope = 'team') desc, a.is_primary desc, a.position, a.name, a.id
   limit 1;
  if account_id is null then
    raise exception 'Для этого способа оплаты нет активного счёта команды';
  end if;
  return account_id;
end;
$function$;

revoke all on function public.resolve_appointment_finance_account(uuid, text, text)
  from public, anon, authenticated;

-- Пикер приёма оплаты у мастера. Проекция намеренно тощая — ни балансов, ни
-- скрытых полей: мастер видит НАЗВАНИЯ касс, в которые может принять деньги, и
-- никогда сами деньги. Изменена ТОЛЬКО строка order by: первым чипом теперь
-- встаёт основная касса бригады, то есть та же, которую выберет сервер.
create or replace function public.list_payment_accounts_safe(p_team_id text)
returns setof jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'id', a.id,
    'name', a.name,
    'kind', a.kind,
    'scope', a.scope,
    'icon', a.icon,
    'color', a.color,
    'position', a.position
  )
    from public.accounts a
   where p_team_id is not null
     and btrim(p_team_id) <> ''
     and a.tenant_id = public.current_tenant_id()
     and a.is_active = true
     and (
       public.current_user_role() in ('owner', 'dispatcher')
       or p_team_id = any(public.current_user_team_ids())
     )
     and (
       (a.scope = 'team' and a.brigade_id = p_team_id)
       or (a.scope = 'company' and exists (
         select 1 from public.account_teams att
          where att.account_id = a.id and att.team_id = p_team_id
       ))
     )
   order by (a.scope = 'team') desc, a.is_primary desc, a.position, a.name, a.id
$function$;

revoke all on function public.list_payment_accounts_safe(text) from public, anon;
grant execute on function public.list_payment_accounts_safe(text) to authenticated;

-- ─── 5. Deploy assertions ────────────────────────────────────────────
do $audit$
declare
  duplicate_positions integer;
  duplicate_primaries integer;
begin
  if not exists (
    select 1 from pg_attribute
     where attrelid = 'public.accounts'::regclass
       and attname = 'is_primary'
       and not attisdropped
       and attnotnull
  ) then
    raise exception 'счета: колонки accounts.is_primary нет или она допускает NULL';
  end if;

  if to_regclass('public.ux_accounts_primary_per_brigade') is null then
    raise exception 'счета: нет уникального индекса основного счёта бригады';
  end if;

  -- Без nulls not distinct индекс не удержал бы счета компании (brigade_id NULL).
  if not exists (
    select 1 from pg_index
     where indexrelid = 'public.ux_accounts_primary_per_brigade'::regclass
       and indnullsnotdistinct
  ) then
    raise exception 'счета: индекс основного счёта создан без nulls not distinct — счета компании не защищены';
  end if;

  select count(*) into duplicate_positions
    from (
      select tenant_id, brigade_id, position
        from public.accounts
       group by tenant_id, brigade_id, position
      having count(*) > 1
    ) dupes;
  if duplicate_positions > 0 then
    raise exception 'счета: после бэкфилла осталось % групп с одинаковой позицией', duplicate_positions;
  end if;

  select count(*) into duplicate_primaries
    from (
      select tenant_id, brigade_id
        from public.accounts
       where is_primary
       group by tenant_id, brigade_id
      having count(*) > 1
    ) dupes;
  if duplicate_primaries > 0 then
    raise exception 'счета: % бригад с двумя основными счетами', duplicate_primaries;
  end if;

  -- У каждой группы с активными счетами основной обязан быть назначен — иначе
  -- резолвер снова начнёт решать порядком строк. Условие повторяет предикат
  -- бэкфилла слово в слово (основной ищется по всей группе, включая закрытые
  -- счета), поэтому после успешного бэкфилла оно заведомо пусто.
  if exists (
    select 1
      from public.accounts a
     where a.is_active
       and not exists (
         select 1
           from public.accounts p
          where p.tenant_id = a.tenant_id
            and p.brigade_id is not distinct from a.brigade_id
            and p.is_primary
       )
  ) then
    raise exception 'счета: есть бригада с активными счетами, но без основного';
  end if;

  if (select count(*)
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in (
           'resolve_appointment_finance_account',
           'list_payment_accounts_safe'
         )
         and p.prosrc like '%is_primary desc%') <> 2 then
    raise exception 'счета: резолвер выбирает счёт без учёта основного';
  end if;
end;
$audit$;
