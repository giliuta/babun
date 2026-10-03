-- «ИСТОЧНИКИ» ПОД СТОРОЖЕМ ТАРИФА (аудит прав клиентов 03.10).
--
-- Когда тариф владельца команды закончился («партнёры только смотрят»,
-- `tenant_partner_writes_guard`, 02.10), партнёр не может менять ни теги, ни
-- типы объектов, ни дизайн команды — а свои источники клиентов (таблица
-- `client_sources`, 03.10) мог: сторожа на ней не было. Ставим тот же, что на
-- `client_tags`. Владельца он не трогает.

set local lock_timeout = '5s';

drop trigger if exists client_sources_partner_writes_guard on public.client_sources;
create trigger client_sources_partner_writes_guard
  before insert or delete or update on public.client_sources
  for each row execute function public.tenant_partner_writes_guard();
