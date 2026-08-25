# Coding Patterns — Babun

Стек: Expo SDK 54 / React Native, expo-router, NativeWind, Supabase.
Веб — тот же код через React Native Web (Next.js снесён 2026-08-25).

## TypeScript
- **Strict mode ON.** `any` is forbidden. If a type is hard, write an interface.
- **Named exports** everywhere. The one exception: files under
  `apps/mobile/app/**` are expo-router routes and must default-export the screen
  component.
- **Type imports** with `import type {...}` where possible — helps tree-shaking.
- **No `ts-ignore`**, no `@ts-expect-error` without a comment explaining why.

```ts
// ✅ Good — тип импортирован через `import type`, экспорт именованный
import type { Appointment } from "@babun/shared/local/appointments";

export function formatStart(apt: Appointment): string { ... }

// ❌ Bad — default-экспорт вне `apps/mobile/app/**` и `any` вместо типа
export default function formatStart(apt: any): any { ... }
```

## Данные

- **Серверные данные — TanStack Query поверх Supabase repositories**
  (`packages/shared/src/db/repositories/*`). Не ходить в `supabase.from(...)`
  из компонента напрямую — репозиторий один на сущность.
- **Offline** — снимок в SQLite-кэше (`packages/shared/src/storage/sql`) плюс
  очередь мутаций в `packages/shared/src/sync`. Реалтайм инвалидирует запросы.
- **Локальные справочники и настройки** — синхронные стораджи в
  `packages/shared/src/local/*`.

## Storage seam

Синхронное key-value хранение идёт ТОЛЬКО через seam — он платформенный:
MMKV на нативе, `localStorage` на вебе. Биндится один раз в
`apps/mobile/src/bootstrap.ts` (первый импорт в `app/_layout.tsx`); до этого
`getStorage()` бросает, чтобы данные не терялись молча.

`get`/`set` сами делают JSON; `getRaw`/`setRaw` — для легаси-ключей с голыми
строками, которые уже лежат на устройствах пользователей, и для случая, когда
надо отличить «ключа никогда не было» от «сохранён пустой список»: `getRaw`
возвращает `null` только при отсутствии ключа, а сохранённый `[]` приходит
строкой `"[]"`.

Живой образец — `packages/shared/src/local/personal-event-types.ts`:

```ts
import { getStorage } from "../storage/provider";

const STORAGE_KEY = "babun2:settings:personal-event-types";

export function loadPersonalEventTypes(): PersonalEventType[] {
  // Первый запуск (ключа нет) → сеем дефолты. Пользователь удалил всё
  // (лежит "[]") → уважаем пустой список, иначе типы воскресают сами.
  const raw = getStorage().getRaw(STORAGE_KEY);
  if (raw === null) return SEED_PERSONAL_EVENT_TYPES;

  const parsed = getStorage().get<PersonalEventType[]>(STORAGE_KEY);
  if (!Array.isArray(parsed)) return SEED_PERSONAL_EVENT_TYPES;
  return parsed;
}

export function savePersonalEventTypes(types: PersonalEventType[]): void {
  getStorage().set(STORAGE_KEY, types);
}
```

**LEGACY:** часть файлов в `packages/shared/src/local/*` до сих пор дёргает
`window.localStorage` напрямую с охраной `typeof window === "undefined"`. На
нативе такие функции молча ничего не сохраняют. Образцом для нового кода они не
являются — при касании такого файла переводи его на `getStorage()`.

## Провайдеры

Дерево провайдеров одно и живёт в `apps/mobile/src/providers/AppProviders.tsx`
(SafeArea → QueryClient → Session → …), подключается из `app/_layout.tsx`. Не
заводи провайдер на экран: один общий стек = одна общая картина данных.

## Components

```tsx
// ✅ Named export, typed props interface, NativeWind className
interface AppointmentBlockProps {
  appointment: Appointment;
  hourHeight?: number;  // optional with default
  onPress: (apt: Appointment) => void;
}

export function AppointmentBlock({
  appointment,
  hourHeight = 64,
  onPress,
}: AppointmentBlockProps) {
  return (
    <Pressable
      onPress={() => onPress(appointment)}
      className="absolute left-0.5 right-0.5 rounded-[10px] active:opacity-80"
    >
      <Text>{appointment.time_start}</Text>
    </Pressable>
  );
}
```

**Rules:**
- Max 400 lines per file. Split sub-components into private functions in the same file or move to `src/components/{area}/`.
- Props interface is typed, optional props have defaults.
- Event handlers use `handle{Event}` naming.
- `Pressable` + состояние нажатия вместо hover — hover в RN не существует.
- No inline objects in JSX unless trivial — memo via `useMemo` if it matters.

## Styling

- **NativeWind (Tailwind v4 синтаксис)** — `className` на RN-компонентах.
  Единственный CSS-файл — `apps/mobile/global.css` с токенами.
- Цвета берутся из токенов и `src/theme/colors.ts`; бренд — `--color-brand: #2c5be0`.
  Канон — `apps/mobile/docs/DESIGN-SYSTEM.md`, свои оттенки не заводить.
- Радиус — только `rounded-[10px]`, `rounded-t-[10px]`, `rounded-full`.
- Safe-area — через `react-native-safe-area-context`, а не через `env(safe-area-inset-*)`.
- Тема строго светлая: dark-палитры и системного переключения нет.

## Supabase RLS

Каждая tenant-таблица несёт `tenant_id` и включённый RLS; политики лежат в
`supabase/migrations/`.

```sql
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation" ON clients
  FOR ALL USING (tenant_id = public.current_tenant_id());
```

**Never pass `tenant_id` from the client.** RLS + JWT claim handles isolation.
Привилегированные операции (service-ключ) — только в `supabase/functions/*`.

## Error handling

```ts
// ✅ Explicit, recoverable
try {
  const data = JSON.parse(raw);
  return Array.isArray(data) ? data : DEFAULTS;
} catch {
  return DEFAULTS;
}

// ✅ Propagate with context
if (error) {
  throw new Error(`Failed to fetch clients: ${error.message}`);
}

// ❌ Swallow silently
try { doThing(); } catch (e) { /* nothing */ }
```

## Naming

| What | Style | Example |
|---|---|---|
| Components | PascalCase | `ClientCard.tsx` |
| Utilities, hooks | camelCase | `formatCurrency.ts`, `useAppointments.ts` |
| Types, interfaces | PascalCase | `type ClientWithAppointments` |
| DB columns | snake_case | `first_contact_date` |
| Route files | kebab-case под `apps/mobile/app/` | `app/(dashboard)/clients/object-types.tsx` |
| Storage keys | новый ключ — `babun2:<область>:<имя>`, двоеточия как разделитель | `babun2:settings:personal-event-types` |
| Query keys | массив от общего к частному | `["clients", tenantId, filter]` |

В дереве живут и более старые формы ключей — `babun-clients-sort`,
`babun:auth:last-user-id`. Они лежат на устройствах пользователей, поэтому
переименованию не подлежат: правило `babun2:` — только для НОВЫХ ключей.

## Commits

```
feat: add client acquisition source field
fix: reset password link opened the wrong screen on web
refactor: split ClientsFilterSheet into facets
docs: bring architecture.md back in line with the RN-only tree
```

- Imperative mood, lowercase type prefix
- One logical change per commit
- Body explains WHY when not obvious from diff

## When in doubt
- Read the existing file in the same folder — match its style
- Правила проекта — `AGENTS.md`; дизайн — `apps/mobile/docs/DESIGN-SYSTEM.md`
- Don't invent new patterns when an established one exists
