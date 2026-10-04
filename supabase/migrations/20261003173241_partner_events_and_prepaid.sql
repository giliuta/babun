-- СОБЫТИЕ ПАРТНЁРА И ЕГО ПРЕДОПЛАТА (повторный аудит календаря 03.10).
--
-- 1. НОВОЕ СОБЫТИЕ — ЦЕЛИКОМ ЕГО. Партнёр с «Записи событий: Видит и
--    создаёт», но без «Тип события: Меняет» (по умолчанию тип скрыт) не мог
--    создать НИ ОДНОГО события: название и цвет события — это блок «Тип», и
--    дверь создания проверяла их как правку. Быстрое событие («Обед»)
--    мигало и исчезало с «Нет права «Тип события»», форма отвечала «Не
--    удалось сохранить» — у события из формы название есть всегда. С
--    24.09 у рабочей записи правило уже такое: блоки решают ПРАВКУ
--    созданной, а не её рождение. Теперь и у события: название, цвет и
--    заметку своего нового события партнёр задаёт сам. Клиент, объект и
--    метка события по-прежнему идут по своим блокам; ПРАВКА созданного —
--    по-прежнему по «Типу».
--
-- 2. ПРЕДОПЛАТА В КАЛЕНДАРЕ ПАРТНЁРА. Список записей сотрудника отдавал
--    `prepaid_amount` нулём всегда, даже при открытых «Сумме» и «Оплате», а
--    доплату (`paid_amount`) — честно. У записи €100 с предоплатой €30 и
--    доплатой €70 «Финансы дня» партнёра показывали «Долг €30», а у записи с
--    одной предоплатой долгом стояла вся сумма. Теперь предоплата приходит
--    по тому же правилу, что и доплата.
--
-- ПРАВКА ЖИВЫХ ТЕЛ ПО ЯКОРЮ: тело берётся из базы, сверяется md5 (03.10),
-- меняется ровно один фрагмент. Тело поменяли с тех пор — миграция падает, а
-- не затирает чужое.

do $migration$
declare
  fn regprocedure := 'public.member_appointment_create(jsonb)'::regprocedure;
  def text;
  old_part text := $old$    else
      perform public.member_check_appointment_field(
        k, v_rest -> k, v_kind, v_team, auth.uid(), 'scheduled'
      );
    end if;$old$;
  new_part text := $new$    elsif k in ('comment', 'color_override', 'event_notes', 'event_url') then
      -- НОВОЕ СОБЫТИЕ — ЕГО (повторный аудит 03.10): название, цвет и
      -- заметку своего нового события задаёт автор, как у новой рабочей
      -- записи; блоки события решают правку созданного.
      null;
    else
      perform public.member_check_appointment_field(
        k, v_rest -> k, v_kind, v_team, auth.uid(), 'scheduled'
      );
    end if;$new$;
begin
  if (select md5(prosrc) from pg_proc where oid = fn) <> 'b3d4d2468482cc503d2b15fb2779746f' then
    raise exception 'member_appointment_create изменилась после аудита 03.10 — перечитать тело перед правкой';
  end if;
  def := pg_get_functiondef(fn);
  if (length(def) - length(replace(def, old_part, ''))) / length(old_part) <> 1 then
    raise exception 'ветка проверки полей события не найдена ровно один раз';
  end if;
  execute replace(def, old_part, new_part);
end
$migration$;

do $migration$
declare
  fn regprocedure := 'public.list_master_appointments_safe(integer, integer)'::regprocedure;
  def text;
  old_part text := $old$    'prepaid_amount', 0,$old$;
  new_part text := $new$    -- Предоплата — по тому же правилу, что доплата (повторный аудит 03.10):
    -- нулём она превращалась в долг на экране партнёра.
    'prepaid_amount', case
      when v.see_payment and v.see_amount then coalesce(a.prepaid_amount, 0)
      else 0
    end,$new$;
begin
  if (select md5(prosrc) from pg_proc where oid = fn) <> '7d1af7d7218f1f7c7c352391a786094e' then
    raise exception 'list_master_appointments_safe изменилась после аудита 03.10 — перечитать тело перед правкой';
  end if;
  def := pg_get_functiondef(fn);
  if (length(def) - length(replace(def, old_part, ''))) / length(old_part) <> 1 then
    raise exception 'поле prepaid_amount не найдено ровно один раз';
  end if;
  execute replace(def, old_part, new_part);
end
$migration$;
