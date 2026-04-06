---
name: supabase-query
description: Паттерны запросов к Supabase для Babun
---

## Read (Server Component)

```tsx
import { createClient } from "@/lib/supabase/server";

export default async function Page() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select("*, client:clients(*), crew:crews(*), items:order_items(*)")
    .order("created_at", { ascending: false })
    .range(0, 19);
  // RLS автоматически фильтрует по tenant_id
}
```

## Joins

```tsx
// Заказ с клиентом и бригадой
.select('*, client:clients(full_name, phone), crew:crews(name, city)')

// Клиент с оборудованием
.select('*, equipment:client_equipment(*)')

// Заказ с позициями и услугами
.select('*, items:order_items(*, service:services(name, price))')
```

## Filters

```tsx
.eq('status', 'new')
.in('city', ['limassol', 'paphos'])
.gte('scheduled_date', '2025-01-01')
.ilike('full_name', `%${search}%`)
.or('full_name.ilike.%search%,phone.ilike.%search%')
```

## Realtime

```tsx
supabase
  .channel("orders")
  .on(
    "postgres_changes",
    { event: "*", schema: "public", table: "orders" },
    handler,
  )
  .subscribe();
```
