-- СЛУЖЕБНЫЕ ФУНКЦИИ БЕЗ ВЫЗОВОВ (зачистка 13.10).
--
-- Их не зовут ни приложение, ни другие функции, ни триггеры, ни политики, ни
-- cron, ни edge-функции (сверено с кодом и с выложенной tariff-checkout v6).
--   • _mcp_probe — заглушка `return 1` без search_path, открытая каждому
--     вошедшему (советник Supabase: function_search_path_mutable). Ни в одной
--     миграции её нет: заведена разовым запросом для проверки связи.
-- Две следующие закрыты от anon и authenticated — приложение их звать не
-- могло ни в одной сборке:
--   • tariff_partner_count — считала партнёров для отказа в понижении тарифа
--     Соло · Про · Макс (20261001183700). С 12.10 цена — за календарь, люди
--     бесплатно, tariff-checkout партнёров больше не считает.
--   • document_series_started — «выпущен ли в серии документ» для ручного
--     старта серии только до первого документа (20261001001000). С 04.10 номер
--     ставится вручную в любой момент (20261004021143), проверка не нужна.

drop function if exists public.tariff_partner_count(uuid);
drop function if exists public.document_series_started(uuid, uuid, text, integer);
drop function if exists public._mcp_probe();
