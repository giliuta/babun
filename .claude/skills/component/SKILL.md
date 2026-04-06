---
name: component
description: Создание React компонентов для Babun
---

## Шаблоны

### Server Component (default)

```tsx
import { getTranslations } from "next-intl/server";

export default async function ComponentName() {
  const t = await getTranslations("namespace");
  return <div>{t("key")}</div>;
}
```

### Client Component (только для интерактивности)

```tsx
"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

export default function ComponentName() {
  const t = useTranslations("namespace");
  return <div>{t("key")}</div>;
}
```

## Правила

1. Тексты через t() — добавь ключи в ru.json и en.json
2. shadcn/ui: `import { Button } from '@/components/ui/button'`
3. Стили: Tailwind only, без CSS modules
4. Props: `type Props = { ... }` не interface
5. Loading: Skeleton, Error: Alert
6. Иконки: Lucide React 16-20px
