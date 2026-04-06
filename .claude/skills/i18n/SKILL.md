---
name: i18n
description: Интернационализация через next-intl для Babun
---

## Структура

```
messages/
  ru.json    # Основной (всегда заполнен)
  en.json    # Английский
  el.json    # Греческий (позже)
```

## Server Component

```tsx
import { getTranslations } from "next-intl/server";
const t = await getTranslations("orders");
t("title"); // "Заказы"
t("status.new"); // "Новый"
```

## Client Component

```tsx
import { useTranslations } from "next-intl";
const t = useTranslations("orders");
```

## JSON структура

```json
{
  "common": {
    "save": "Сохранить",
    "cancel": "Отмена",
    "delete": "Удалить",
    "search": "Поиск",
    "loading": "Загрузка..."
  },
  "orders": {
    "title": "Заказы",
    "create": "Новый заказ",
    "status": { "new": "Новый", "confirmed": "Подтверждён" }
  },
  "clients": { "title": "Клиенты", "add": "Добавить клиента" }
}
```

## Правило

При создании ЛЮБОГО текстового элемента — сразу добавь ключ в ru.json и en.json.
Никогда не хардкодь строки на русском в JSX.
