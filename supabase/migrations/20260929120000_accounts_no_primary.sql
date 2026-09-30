-- «ОСНОВНОГО СЧЁТА» БОЛЬШЕ НЕТ — ОСНОВНОЙ ТОТ, ЧТО ВЫШЕ В СПИСКЕ (владелец
-- 2026-09-29: «для чего нам основной счёт — непонятно»; «накатываю и убираю
-- основной»).
--
-- Флажок `is_primary` решал две вещи: какую из нескольких касс одного вида
-- брать, когда оплату записали способом без выбора счёта, и какой счёт ставить
-- первым среди плиток оплаты. Второе спорило с рукой: владелец переносил
-- «Карту» первой, а в оплате первыми оставались «Наличные». Теперь обе вещи
-- решает порядок на странице «Счета» (`position`): выше в списке — первым в
-- оплате и первым среди счетов своего вида.
--
-- Колонка остаётся (её читают уже установленные сборки), но порядок она
-- больше не задаёт. Тела функций не переписываются руками: в живом
-- определении меняется ровно одна строка сортировки.

do $$
declare
  def text;
  fn text;
  old_frag text := 'order by (a.scope = ''team'') desc, a.is_primary desc, a.position, a.name, a.id';
  new_frag text := 'order by (a.scope = ''team'') desc, a.position, a.name, a.id';
begin
  foreach fn in array array['resolve_appointment_finance_account', 'list_payment_accounts_safe']
  loop
    select pg_get_functiondef(p.oid) into def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fn;
    if def is null then
      raise exception 'функции % нет', fn;
    end if;
    if (length(def) - length(replace(def, old_frag, ''))) / length(old_frag) <> 1 then
      raise exception 'в % порядок счетов встречается не ровно один раз', fn;
    end if;
    execute replace(def, old_frag, new_frag);
  end loop;
end
$$;

do $$
begin
  if exists (
    select 1 from pg_proc
     where proname in ('resolve_appointment_finance_account', 'list_payment_accounts_safe')
       and prosrc like '%is_primary%'
  ) then
    raise exception 'основной счёт всё ещё решает порядок';
  end if;
end
$$;
