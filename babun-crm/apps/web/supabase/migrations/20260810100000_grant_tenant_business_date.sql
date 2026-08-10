-- ПРИЁМ ОПЛАТЫ ПО ИНВОЙСУ ПАДАЛ У ВСЕХ.
--
-- «Принять оплату» отвечало «permission denied for function
-- tenant_business_date». record_invoice_payment выполняется ОТ ИМЕНИ
-- ВЫЗЫВАЮЩЕГО (не security definer) и внутри спрашивает у tenant_business_date
-- сегодняшнюю дату тенанта — а у той функции не было ни одного гранта, кроме
-- postgres. То есть оплатить выставленный счёт из приложения было нельзя
-- вообще: деньги приходили, а документ оставался «Выставлен».
--
-- Функция ничего не раскрывает: по tenant_id она возвращает сегодняшнюю дату
-- в часовом поясе тенанта (и Europe/Nicosia, если пояс не задан).

grant execute on function public.tenant_business_date(uuid) to authenticated;
