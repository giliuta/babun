# BABUN — CRM для сервисных бизнесов

## Проект

Multi-tenant SaaS CRM для выездных сервисов. Первый клиент: **AirFix** (обслуживание кондиционеров, Кипр).
Репо: github.com/giliuta/babun | Деплой: Vercel

## Стек

- **Frontend:** Next.js 14 (App Router), TypeScript strict, Tailwind CSS, shadcn/ui
- **Backend:** Supabase (PostgreSQL + Auth + RLS + Realtime + Storage + Edge Functions)
- **State:** Zustand (global), React Hook Form + Zod (forms)
- **DnD:** @dnd-kit (kanban) | **Charts:** Recharts | **i18n:** next-intl (RU/EN/EL)
- **Bot:** grammy.js (Telegram) через Edge Functions
- **Deploy:** Vercel (frontend), Supabase (backend)

## Архитектура

```
src/
  app/
    [locale]/
      (auth)/login/         # Auth pages
      (dashboard)/          # Protected layout
        orders/             # Kanban + list + detail
        clients/            # Client cards + equipment
        calendar/           # Daily/weekly by city
        crews/              # Crew management
        finance/            # Payments, expenses, salary
        inbox/              # Unified messenger
        reports/            # Analytics, P&L
        settings/           # Tenant settings
  components/
    ui/                     # shadcn/ui (НЕ кастомить)
    shared/                 # Reusable project components
  lib/
    supabase/               # Client, server, middleware helpers
    actions/                # Server Actions (mutations)
    queries/                # Data fetching (reads)
    stores/                 # Zustand stores
    validations/            # Zod schemas
  types/                    # Generated Supabase types + custom
```

## Критичные правила

1. **RLS обязателен.** Каждая таблица фильтруется по tenant_id. Никогда не используй service_role в клиентском коде.
2. **Server Components по умолчанию.** 'use client' только для интерактивности (формы, DnD, charts).
3. **Все тексты через t().** Сразу добавляй ключи в ru.json и en.json.
4. **shadcn/ui компоненты.** Не создавать кастомные если есть готовые.
5. **Zod-схемы = DB constraints.** Валидация на клиенте совпадает с ограничениями в БД.
6. **Цикл разработки:** код → build → screenshot → fix → push only when perfect.

## AirFix специфика

- Города: Limassol, Paphos, Larnaca, Nicosia
- Бригады: 2 (расширяемо)
- Цены: €50/ед, €45 от 3 единиц
- Фото before/after обязательны при закрытии заказа
- Telegram-бот для бригад: получение заказов, отметка выполнения, отправка фото
- Без скидок, без фреона в рекламе

## Документация

Детали в `docs/`: SCHEMA.md, PROMPTS.md, DESIGN.md, API.md, MASTER-PLAN.md
