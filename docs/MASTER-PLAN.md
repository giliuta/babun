# BABUN — Master Plan

## Фаза 0: Инфраструктура (1 день)

1. Создай проект в Supabase (eu-central-1, название: babun)
2. `npx create-next-app@14 babun --typescript --tailwind --eslint --app --src-dir`
3. Скопируй этот пакет файлов в корень проекта
4. `npx shadcn-ui@latest init` (New York style, Zinc base, CSS variables: yes)
5. Установи зависимости:
   ```bash
   npm i @supabase/supabase-js @supabase/ssr zustand zod react-hook-form @hookform/resolvers next-intl sonner @dnd-kit/core @dnd-kit/sortable recharts grammy date-fns lucide-react
   npm i -D supabase @types/node
   ```
6. Настрой `.env.local`:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
   SUPABASE_SERVICE_ROLE_KEY=xxx  # ТОЛЬКО серверный код!
   TELEGRAM_BOT_TOKEN=xxx
   ```
7. Выполни миграцию: `supabase/migrations/00001_initial_schema.sql` в SQL Editor
8. Подключи MCP серверы:
   ```bash
   claude mcp add --scope user supabase npx -y @anthropic-ai/supabase-mcp --supabase-url $SUPABASE_URL --supabase-key $SERVICE_ROLE_KEY
   claude mcp add --scope user playwright npx @playwright/mcp@latest
   claude mcp add --scope user sequential-thinking npx -y @anthropic-ai/sequential-thinking
   ```
9. Сгенерируй типы: `npx supabase gen types typescript --project-id xxx > src/types/database.ts`
10. Push to GitHub: `git init && git remote add origin git@github.com:giliuta/babun.git`

## Фаза 1: Auth + Layout (2-3 дня)

- Supabase Auth (email/password, magic link)
- Middleware: redirect unauthenticated → /login
- Tenant creation on first signup
- Dashboard layout: sidebar + header + main
- Profile settings page

## Фаза 2: Clients + Equipment (2-3 дня)

- Client list (table + search + filter by city)
- Client card (contact info, equipment, order history)
- Add/edit client form (Zod validation)
- Equipment CRUD (indoor/outdoor units per client)

## Фаза 3: Orders — Kanban (3-5 дней)

- Kanban board: columns = statuses (new → confirmed → scheduled → in_progress → completed)
- Order creation form: select client → add services → assign crew → set date
- Order detail page: items, comments, photos, payments
- Auto-calculate total (€50/unit, €45 from 3+)
- Drag & drop status change (@dnd-kit)
- Activity log (comments + status changes)

## Фаза 4: Crews + Calendar (2-3 дня)

- Crew management (name, city, phone, color)
- Calendar view: daily/weekly, filter by city
- Crew assignment on order
- Crew workload visualization

## Фаза 5: Finance (3-4 дня)

- Payment recording on order completion
- Expense tracking (fuel, materials, ads, salary)
- Salary records per worker per period
- Basic P&L report (income - expenses = profit)

## Фаза 6: Telegram Bot (3-4 дня)

- grammy.js bot via Supabase Edge Functions
- Crew bot: receive new orders, mark completed, send photos
- Client notifications: order confirmed, crew on the way, completed

## Фаза 7: Inbox (3-4 дня)

- Unified conversation view (TG + WA)
- Message history per client
- Quick replies / templates
- Realtime updates via Supabase Realtime

## Фаза 8: Reports (2-3 дня)

- Revenue by period / city / crew
- Order conversion funnel
- Client LTV
- Expense breakdown
- Crew productivity

## Фаза 9: AI Marketing (3-5 дней)

- Re-engagement: clients not serviced in 3+ months
- Auto-reminders: seasonal service notifications
- Smart scheduling suggestions
- Template-based notification engine
