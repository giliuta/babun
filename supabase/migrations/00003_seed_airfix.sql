-- AirFix seed data
-- Run AFTER handle_signup has created the tenant
-- Replace TENANT_ID or use the subquery below

DO $$
DECLARE
  v_tid UUID;
BEGIN
  SELECT id INTO v_tid FROM tenants WHERE slug = 'airfix' LIMIT 1;
  IF v_tid IS NULL THEN
    RAISE NOTICE 'No airfix tenant found — skipping seed';
    RETURN;
  END IF;

  -- Services
  INSERT INTO services (tenant_id, name, name_en, price, price_bulk, bulk_threshold, duration_minutes, sort_order) VALUES
    (v_tid, 'Чистка внутреннего блока', 'Indoor unit cleaning', 50.00, 45.00, 3, 45, 1),
    (v_tid, 'Чистка наружного блока', 'Outdoor unit cleaning', 50.00, 45.00, 3, 30, 2),
    (v_tid, 'Диагностика', 'Diagnostics', 30.00, NULL, NULL, 30, 3),
    (v_tid, 'Установка кондиционера', 'AC installation', 250.00, NULL, NULL, 180, 4),
    (v_tid, 'Демонтаж кондиционера', 'AC removal', 150.00, NULL, NULL, 120, 5)
  ON CONFLICT DO NOTHING;

  -- Crews
  INSERT INTO crews (tenant_id, name, city, color) VALUES
    (v_tid, 'Бригада 1', 'limassol', '#3B82F6'),
    (v_tid, 'Бригада 2', 'paphos', '#10B981')
  ON CONFLICT DO NOTHING;

  -- Notification templates
  INSERT INTO notification_templates (tenant_id, name, trigger_event, channel, template_ru, template_en, variables) VALUES
    (v_tid, 'Заказ подтверждён', 'order_confirmed', 'telegram',
     '✅ Ваш заказ #{order_number} подтверждён на {date}. Бригада прибудет в указанное время. AirFix',
     '✅ Your order #{order_number} is confirmed for {date}. The crew will arrive at the specified time. AirFix',
     ARRAY['order_number', 'date']),
    (v_tid, 'Заказ завершён', 'order_completed', 'telegram',
     '✨ Обслуживание завершено! Спасибо что выбрали AirFix. Будем рады видеть вас снова!',
     '✨ Service completed! Thank you for choosing AirFix. See you next time!',
     ARRAY[]),
    (v_tid, 'Напоминание о сервисе', 're_engage_3m', 'telegram',
     '👋 Прошло 3 месяца с последнего обслуживания кондиционеров. Самое время для профилактической чистки!',
     '👋 It''s been 3 months since your last AC service. Time for maintenance cleaning!',
     ARRAY[])
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'AirFix seed data inserted for tenant %', v_tid;
END;
$$;
