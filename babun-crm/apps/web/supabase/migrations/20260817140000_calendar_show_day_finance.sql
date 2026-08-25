-- ДЕНЬГИ ПОД СЕТКОЙ — НАСТРОЙКА, А НЕ ДОГАДКА.
--
-- Владелец 2026-08-17: «почему у меня внизу нет расход доход, куда он пропал?
-- Это также должно быть, и также должно быть в настройках — то есть надо
-- добавить: включать расход-доход или нет, просто как функция, что можно видеть
-- в календаре».
--
-- Полоса «Доход / Расход» под сеткой НЕ пропадала: она сама себя скрывала,
-- когда за всю видимую неделю не набиралось ни цента (`DayFinanceFooter`
-- возвращал null, чтобы не занимать две строки семью нулями). Догадка вместо
-- решения: владелец открывает пустую неделю новой бригады и видит, что функция
-- исчезла из продукта. Теперь ответ даёт ОН, и ответ живёт в колонке — значит
-- переезжает вместе с ним на второе устройство, а не остаётся на телефоне.
--
-- Дефолт `true`: полоса — то, ради чего календарь открывают в конце дня, и
-- новый тенант обязан увидеть её без похода в настройки.

alter table public.calendar_settings
  add column if not exists show_day_finance boolean not null default true;

comment on column public.calendar_settings.show_day_finance is
  'Показывать полосу «Доход / Расход» под сеткой календаря. Виден только владельцу (роль owner).';

-- ─── Deploy assertions ───────────────────────────────────────────────
do $audit$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'calendar_settings'
       and column_name = 'show_day_finance'
       and data_type = 'boolean'
       and is_nullable = 'NO'
  ) then
    raise exception 'Календарь: колонка show_day_finance не создалась';
  end if;

  if exists (select 1 from public.calendar_settings where show_day_finance is null) then
    raise exception 'Календарь: show_day_finance пуст у существующих строк';
  end if;
end;
$audit$;
