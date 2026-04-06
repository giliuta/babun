# BABUN — Seed Data (AirFix)

Выполни после создания первого пользователя (owner) и tenant.
Замени `TENANT_ID` на реальный UUID.

```sql
-- Services (AirFix прайс-лист)
INSERT INTO services (tenant_id, name, name_en, price, price_bulk, bulk_threshold, duration_minutes, sort_order) VALUES
  ('TENANT_ID', 'Чистка внутреннего блока', 'Indoor unit cleaning', 50.00, 45.00, 3, 45, 1),
  ('TENANT_ID', 'Чистка наружного блока', 'Outdoor unit cleaning', 50.00, 45.00, 3, 30, 2),
  ('TENANT_ID', 'Диагностика', 'Diagnostics', 30.00, NULL, NULL, 30, 3),
  ('TENANT_ID', 'Установка кондиционера', 'AC installation', 250.00, NULL, NULL, 180, 4),
  ('TENANT_ID', 'Демонтаж кондиционера', 'AC removal', 150.00, NULL, NULL, 120, 5);

-- Crews
INSERT INTO crews (tenant_id, name, city, color) VALUES
  ('TENANT_ID', 'Бригада 1', 'limassol', '#3B82F6'),
  ('TENANT_ID', 'Бригада 2', 'paphos', '#10B981');

-- Notification templates
INSERT INTO notification_templates (tenant_id, name, trigger_event, channel, template_ru, template_en, variables) VALUES
  ('TENANT_ID', 'Заказ подтверждён', 'order_confirmed', 'telegram',
   '✅ Ваш заказ #{order_number} подтверждён на {date}. Бригада прибудет в указанное время. AirFix',
   '✅ Your order #{order_number} is confirmed for {date}. The crew will arrive at the specified time. AirFix',
   ARRAY['order_number', 'date']),
  ('TENANT_ID', 'Бригада выехала', 'crew_departed', 'telegram',
   '🚗 Бригада AirFix выехала к вам. Ориентировочное время прибытия: {eta}',
   '🚗 AirFix crew is on the way. ETA: {eta}',
   ARRAY['eta']),
  ('TENANT_ID', 'Заказ завершён', 'order_completed', 'telegram',
   '✨ Обслуживание завершено! Спасибо что выбрали AirFix. Будем рады видеть вас снова!',
   '✨ Service completed! Thank you for choosing AirFix. See you next time!',
   ARRAY[]),
  ('TENANT_ID', 'Напоминание о сервисе', 're_engage_3m', 'telegram',
   '👋 Прошло 3 месяца с последнего обслуживания кондиционеров. Самое время для профилактической чистки! Запишитесь: +357 XX XXX XXX',
   '👋 It''s been 3 months since your last AC service. Time for a maintenance cleaning! Book now: +357 XX XXX XXX',
   ARRAY[]);
```
