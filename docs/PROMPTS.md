# BABUN — Промпты для Claude Code

## Как использовать

Копируй промпт в Claude Code. Каждый промпт — один этап. Не переходи к следующему пока текущий не завершён и не проверен.

---

## Этап 1: Auth + Layout

### 1.1 Supabase Client Setup

```
Создай Supabase клиенты для Next.js 14 App Router:
1. src/lib/supabase/client.ts — браузерный клиент (createBrowserClient)
2. src/lib/supabase/server.ts — серверный клиент (createServerClient с cookies)
3. src/lib/supabase/middleware.ts — middleware клиент
4. src/middleware.ts — защита роутов, redirect на /login если не авторизован
Используй @supabase/ssr. Типы из src/types/database.ts.
Не используй service_role в клиентском коде.
```

### 1.2 Auth Pages

```
Создай страницы аутентификации:
1. src/app/[locale]/(auth)/login/page.tsx — email + password login
2. src/app/[locale]/(auth)/signup/page.tsx — регистрация (создаёт tenant + profile)
3. src/app/[locale]/(auth)/layout.tsx — центрированный layout без sidebar
Используй shadcn/ui: Card, Input, Button, Label, Form.
Валидация через Zod. Серверные actions через src/lib/actions/auth.ts.
При регистрации: создай tenant → создай profile с role='owner' → set app_metadata.
```

### 1.3 Dashboard Layout

```
Создай layout для dashboard:
1. src/app/[locale]/(dashboard)/layout.tsx — sidebar + header + main
2. src/components/shared/sidebar.tsx — навигация:
   - Orders (ClipboardList)
   - Clients (Users)
   - Calendar (CalendarDays)
   - Crews (Wrench)
   - Finance (DollarSign)
   - Inbox (MessageSquare)
   - Reports (BarChart3)
   - Settings (Settings)
3. src/components/shared/header.tsx — tenant name, user avatar, notifications bell
4. src/components/shared/breadcrumbs.tsx
Sidebar: collapsible, mobile = Sheet. Иконки Lucide React 20px.
Стиль: светлый, clean, минималистичный. shadcn/ui Separator между секциями.
```

---

## Этап 2: Clients

### 2.1 Client List

```
Создай страницу списка клиентов:
1. src/app/[locale]/(dashboard)/clients/page.tsx — Server Component
2. src/lib/queries/clients.ts — getClients(tenantId, filters)
3. Фильтры: город, источник, поиск по имени/телефону
4. Таблица: shadcn/ui Table. Колонки: имя, телефон, город, заказы, последний сервис, сумма
5. Кнопка "Добавить клиента" → Sheet/Dialog
Пагинация серверная. 20 записей на страницу.
```

### 2.2 Client Detail + Equipment

```
Создай страницу клиента:
1. src/app/[locale]/(dashboard)/clients/[id]/page.tsx
2. Вкладки (Tabs): Информация, Оборудование, Заказы, Финансы
3. Информация: контакт, адрес, карта, заметки. Inline editing.
4. Оборудование: список indoor/outdoor блоков. CRUD. Поля: тип, бренд, модель, расположение.
5. Заказы: история заказов (ссылки на /orders/[id])
6. Финансы: total_revenue, баланс, история платежей
Форма редактирования: React Hook Form + Zod. Server Action для сохранения.
```

---

## Этап 3: Orders (Kanban)

### 3.1 Kanban Board

```
Создай канбан-доску заказов:
1. src/app/[locale]/(dashboard)/orders/page.tsx — переключение kanban/list view
2. src/components/orders/kanban-board.tsx — 'use client'
3. Колонки: new, confirmed, scheduled, in_progress, completed
4. Карточка заказа: номер, клиент, город, дата, бригада, сумма, статус оплаты
5. Drag & drop через @dnd-kit — перетаскивание меняет статус (Server Action)
6. Фильтры сверху: город, бригада, дата
Цвета колонок: new=gray, confirmed=blue, scheduled=amber, in_progress=purple, completed=green.
Каждая карточка кликабельна → /orders/[id].
```

### 3.2 Order Creation

```
Создай форму создания заказа:
1. src/components/orders/order-form.tsx — Dialog или отдельная страница
2. Шаг 1: Выбор клиента (Combobox поиск по имени/телефону) или создание нового
3. Шаг 2: Выбор услуг + привязка к оборудованию клиента. Автоподсчёт:
   - До 2 единиц: €50/ед
   - От 3 единиц: €45/ед
   - Наружный блок: добавляется отдельно
4. Шаг 3: Город, адрес (подтянуть из клиента), дата, бригада
5. Сохранение: Server Action → insert order + order_items + order_comment (system: "Заказ создан")
Zod валидация на каждом шаге. Кнопка "Сохранить" disabled пока форма невалидна.
```

### 3.3 Order Detail

```
Создай страницу заказа:
1. src/app/[locale]/(dashboard)/orders/[id]/page.tsx
2. Header: номер, статус (Badge), кнопки действий (подтвердить, назначить, завершить, отменить)
3. Основная инфа: клиент (ссылка), услуги, бригада, дата/время, адрес
4. Позиции заказа: таблица услуг с ценами
5. Фото before/after: grid с upload через Supabase Storage
6. Activity log: timeline комментариев, статус-изменений, оплат
7. Оплата: кнопка "Записать оплату" → method + amount
8. Боковая панель: quick info о клиенте (телефон, оборудование, история)
```

---

## Этап 4: Crews + Calendar

### 4.1 Crews

```
Создай управление бригадами:
1. src/app/[locale]/(dashboard)/crews/page.tsx
2. Карточки бригад: имя, город, лид, телефон, цвет, активность
3. CRUD форма. Привязка workers (profiles с role=worker) к бригаде.
4. Статистика бригады: заказов за месяц, выручка, средний чек
```

### 4.2 Calendar

```
Создай календарь заказов:
1. src/app/[locale]/(dashboard)/calendar/page.tsx
2. Виды: день, неделя (переключатель)
3. Фильтр по городу, по бригаде
4. Слоты с заказами: цвет = бригада, текст = клиент + адрес
5. Клик на слот → /orders/[id]
6. Клик на пустой слот → создание заказа с предзаполненной датой
Не используй внешние calendar-библиотеки. Сделай кастомный grid на CSS Grid.
```

---

## Этап 5: Finance

### 5.1 Payments + Expenses

```
Создай финансовый модуль:
1. src/app/[locale]/(dashboard)/finance/page.tsx
2. Вкладки: Платежи, Расходы, Зарплаты, P&L
3. Платежи: таблица всех платежей, фильтр по дате/методу
4. Расходы: таблица + форма добавления (категория, сумма, описание, чек)
5. Зарплаты: записи по работникам за период
6. P&L: простой отчёт = доходы - расходы = прибыль. По месяцам. Recharts bar chart.
```

---

## Этап 6: Telegram Bot

### 6.1 Bot Setup

```
Создай Telegram бота для бригад:
1. supabase/functions/telegram-webhook/index.ts — Edge Function
2. Обработка команд:
   /start — регистрация по телефону, привязка к profile
   /orders — список назначенных заказов на сегодня/завтра
   /complete [order_number] — отметить заказ выполненным
3. Приём фото — автоматически прикрепляет к текущему in_progress заказу
4. Inline keyboard для подтверждения действий
5. Уведомления бригаде: новый заказ назначен, заказ отменён
Используй grammy.js. Webhook URL: https://xxx.supabase.co/functions/v1/telegram-webhook
```
