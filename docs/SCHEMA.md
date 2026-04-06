# BABUN — Database Schema Reference

## Таблицы и связи

```
tenants
  ├── profiles (tenant_id) → crews (crew_id)
  ├── clients (tenant_id) → client_equipment (client_id)
  ├── crews (tenant_id)
  ├── services (tenant_id)
  ├── discount_rules (tenant_id)
  ├── orders (tenant_id) → clients, crews, profiles
  │     ├── order_items → services, client_equipment
  │     ├── order_comments → profiles
  │     ├── order_photos → profiles
  │     └── payments → clients
  ├── expenses (tenant_id) → crews, profiles
  ├── salary_records (tenant_id) → profiles
  ├── conversations (tenant_id) → clients, profiles
  │     └── messages → profiles
  ├── notification_templates (tenant_id)
  ├── notification_log (tenant_id)
  └── ai_log (tenant_id)
```

## Ключевые enum-значения

**Order statuses:** new → confirmed → scheduled → in_progress → completed | cancelled | no_show
**Payment statuses:** unpaid → partial → paid
**Payment methods:** cash, card, transfer, revolut
**Cities:** limassol, paphos, larnaca, nicosia
**Roles:** owner, manager, worker
**Equipment types:** indoor, outdoor
**Client sources:** manual, facebook, instagram, google, referral, telegram, whatsapp, website, bazaraki, repeat
**Expense categories:** fuel, materials, equipment, ads, rent, salary, tax, insurance, other
**Channels:** telegram, whatsapp, sms, email

## RLS

Все таблицы фильтруются по `tenant_id = get_my_tenant_id()`.
Workers видят только свои заказы (assigned_to или crew_id).

## Триггеры

- `update_updated_at` — авто-обновление updated_at на tenants, profiles, clients, orders
- `update_client_stats` — при завершении заказа обновляет total_orders, total_revenue, last_service_date

## Storage Buckets

- `order-photos` — фото до/после (private, tenant-scoped)
- `receipts` — чеки расходов (private, tenant-scoped)
- `avatars` — аватарки пользователей (public)
