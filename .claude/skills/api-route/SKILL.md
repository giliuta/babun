---
name: api-route
description: Создание Server Actions и API routes для Babun
---

## Server Action (предпочтительно)

```tsx
"use server";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import { revalidatePath } from "next/cache";

const schema = z.object({
  // Zod schema matching DB constraints
});

export async function actionName(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.flatten() };

  const { error } = await supabase.from("table").insert(parsed.data);
  if (error) return { error: error.message };

  revalidatePath("/path");
  return { success: true };
}
```

## Правила

1. Всегда проверяй auth первым
2. Всегда валидируй через Zod
3. RLS делает фильтрацию по tenant — не передавай tenant_id вручную
4. revalidatePath после мутаций
5. Возвращай { error } или { success, data }
