# BABUN — API Conventions

## Server Actions (предпочтительный метод)

Расположение: `src/lib/actions/[module].ts`

### Паттерн

```typescript
"use server";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";

export async function createOrder(formData: FormData) {
  const supabase = await createClient();

  // 1. Auth check
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  // 2. Validate
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.flatten() };

  // 3. Execute (RLS handles tenant filtering)
  const { data, error } = await supabase
    .from("orders")
    .insert(parsed.data)
    .select()
    .single();
  if (error) return { error: error.message };

  // 4. Revalidate
  revalidatePath("/orders");
  return { data };
}
```

## Queries (data fetching)

Расположение: `src/lib/queries/[module].ts`

```typescript
import { createClient } from "@/lib/supabase/server";

export async function getOrders(filters?: OrderFilters) {
  const supabase = await createClient();
  let query = supabase
    .from("orders")
    .select("*, client:clients(*), crew:crews(*)");

  if (filters?.city) query = query.eq("city", filters.city);
  if (filters?.status) query = query.eq("status", filters.status);

  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}
```

## Naming

- Actions: `create[Entity]`, `update[Entity]`, `delete[Entity]`, `change[Entity]Status`
- Queries: `get[Entity]`, `get[Entity]ById`, `get[Entity]Stats`
- Files: kebab-case (`order-actions.ts`, `client-queries.ts`)
