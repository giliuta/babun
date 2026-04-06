---
name: form
description: Создание форм с React Hook Form + Zod для Babun
---

## Шаблон формы

```tsx
"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { toast } from "sonner";

const schema = z.object({
  name: z.string().min(1, "Обязательное поле"),
  phone: z.string().min(8, "Минимум 8 символов"),
});
type FormValues = z.infer<typeof schema>;

export function MyForm({
  onSubmit,
}: {
  onSubmit: (data: FormValues) => Promise<void>;
}) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", phone: "" },
  });

  async function handleSubmit(data: FormValues) {
    try {
      await onSubmit(data);
      toast.success("Сохранено");
      form.reset();
    } catch {
      toast.error("Ошибка");
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Имя</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Сохранение..." : "Сохранить"}
        </Button>
      </form>
    </Form>
  );
}
```

## Правила

1. Zod-схема = DB constraints
2. defaultValues обязательны
3. toast.success/error для фидбека
4. disabled при isSubmitting
5. FormMessage для ошибок валидации
