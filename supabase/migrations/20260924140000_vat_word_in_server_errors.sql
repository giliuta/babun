-- VAT ВМЕСТО НДС В ОШИБКАХ СЕРВЕРА (владелец 2026-09-20: «только давай не
-- НДС, а VAT»; интерфейс переведён 24.09 коммитом 5bb6f80b). Сообщения
-- `raise exception` доезжают до человека как есть — тостом или алертом, — и
-- говорили «НДС» рядом с экраном, где написано «VAT».
--
-- Тела функций НЕ переписываются руками: берётся живое определение
-- (`pg_get_functiondef`), в нём заменяются только строки сообщений, каждая —
-- с проверкой «ровно одно вхождение», и результат исполняется. Логика
-- функций не меняется ни на символ.

do $$
declare
  fn record;
  def text;
  pairs text[][] := array[
    ['set_appointment_vat_mode', 'Войдите в приложение, чтобы выбрать НДС записи', 'Войдите в приложение, чтобы выбрать VAT записи'],
    ['set_appointment_vat_mode', 'Неизвестный режим НДС записи', 'Неизвестный режим VAT записи'],
    ['set_appointment_vat_mode', 'НДС записи выбирает владелец, диспетчер или её команда', 'VAT записи выбирает владелец, диспетчер или её команда'],
    ['set_appointment_vat_mode', 'НДС выбирают только у рабочей заявки', 'VAT выбирают только у рабочей записи'],
    ['fill_transaction_vat', 'Ставка НДС должна быть больше 0 и меньше 100', 'Ставка VAT должна быть больше 0 и меньше 100'],
    ['fill_transaction_vat', 'Ставка НДС — не больше двух знаков после запятой', 'Ставка VAT — не больше двух знаков после запятой'],
    ['fill_transaction_vat', '''НДС % не сходится с суммой', '''VAT % не сходится с суммой']
  ];
  i int;
  name text;
begin
  foreach name in array array['set_appointment_vat_mode', 'fill_transaction_vat'] loop
    select p.oid, pg_get_functiondef(p.oid) as def into fn
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = name;
    if not found then
      raise exception 'функции % нет', name;
    end if;
    def := fn.def;
    for i in 1 .. array_length(pairs, 1) loop
      continue when pairs[i][1] <> name;
      if (length(def) - length(replace(def, pairs[i][2], ''))) / length(pairs[i][2]) <> 1 then
        raise exception 'в % строка «%» встречается не ровно один раз', name, pairs[i][2];
      end if;
      def := replace(def, pairs[i][2], pairs[i][3]);
    end loop;
    execute def;
  end loop;
end
$$;

-- СТОРОЖ: в сообщениях этих функций «НДС» не осталось, «VAT» — на месте.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('set_appointment_vat_mode', 'fill_transaction_vat')
       and p.prosrc ~ 'raise exception ''[^'']*НДС'
  ) then
    raise exception 'в сообщениях осталось слово НДС';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'fill_transaction_vat'
       and p.prosrc like '%Ставка VAT должна быть больше 0 и меньше 100%'
  ) then
    raise exception 'новое сообщение fill_transaction_vat не встало';
  end if;
end
$$;
