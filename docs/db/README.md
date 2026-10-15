# База данных Babun — карта

Схема живёт в Supabase (PostgreSQL 17, проект `rdtokosbqvgemicqeqwz`).
`supabase/migrations/` — история того, как её строили; читать её от начала
до конца, чтобы понять схему, не нужно и не стоит: многие функции там
переписаны по десять раз, а часть тел менялась подстановкой текста в живой
базе. Текущее состояние лежит снимком в `docs/db/schema/`:

| Файл | Что в нём |
|---|---|
| `schema/tables.sql` | 79 таблиц: колонки, умолчания, ограничения, включён ли RLS, комментарии |
| `schema/policies.sql` | политики RLS |
| `schema/functions.sql` | все функции схемы `public` с телами и тем, кому разрешено их звать |
| `schema/triggers.sql` | триггеры |
| `schema/indexes.sql` | индексы помимо ключей и уникальных ограничений |
| `schema/views.sql` | представления |

Снимок — справка, а не миграция: его никогда не накатывают. Он снят
2026-10-13 и отстаёт от базы с первой же новой миграцией. Обновлять его —
тем же коммитом, что и миграцию, запросами из раздела «Как обновить».

## Устройство

**Мультитенантность.** Почти каждая таблица несёт `tenant_id`. Активную
компанию запроса задаёт заголовок `x-babun-tenant`; `current_tenant_id()`
сверяет его с членством (`tenant_members`) и отдаёт id компании или NULL.
На нём стоит большинство политик.

**Права — по календарям и блокам.** Роль в `tenant_members` — смысл
компанейский (владелец, партнёр, мастер). Права работы выдаются на календарь:
`calendar_members.grants` и `member_access`. Помощники `access_*` отвечают на
вопрос «что этот человек видит в этом блоке». Реестр блоков — таблица
`access_blocks`.

**Логика — в базе.** Записи денег, документы, SMS, квоты тарифа, удаление
календаря — это функции `SECURITY DEFINER` и триггеры, а не код приложения.
Правило для всех таких функций:
- `set search_path` задан всегда;
- `execute` отозван у `public` и `anon`, выдан только тем, кому нужен
  (видно в `schema/functions.sql` под каждой функцией);
- новая функция по умолчанию исполнима для `anon` — значит, отзыв пишется в
  той же миграции.

**Группы таблиц.**

| Область | Таблицы |
|---|---|
| Компания и люди | `tenants`, `tenant_members`, `tenant_state`, `invitations`, `teams`, `masters`, `member_access`, `member_calendars`, `calendar_members`, `access_blocks`, `access_templates`, `platform_admins` |
| Календарь | `appointments`, `appointment_photos`, `appointment_links`, `calendar_settings`, `team_schedules`, `team_design`, `day_cities`, `day_extras`, `personal_event_types`, `event_templates`, `recurring_reminders`, `user_calendar_order`, `user_hidden_calendars`, `_calendar_delete_context` |
| Клиенты | `clients`, `client_tags`, `client_tag_assignments`, `client_sources`, `client_attachments`, `client_contact_alerts`, `client_contact_views`, `location_labels`, `location_requests`, `equipment`, `cities` |
| Услуги | `services`, `service_categories`, `service_variants` |
| Деньги | `accounts`, `account_teams`, `finance_transactions`, `finance_transfer_requests`, `finance_categories`, `finance_category_hidden`, `finance_category_order`, `finance_templates`, `team_finance_settings`, `debts`, `deleted_operations`, `_finance_write_context` |
| Документы | `invoices`, `invoice_lines`, `receipts`, `legal_entities`, `document_sequences` |
| SMS | `sms_messages`, `sms_logs`, `sms_ledger`, `sms_topups`, `sms_autotopup`, `sms_alerts`, `sms_team_senders`, `sms_team_templates`, `tenant_sms_config` |
| Тариф и оплата | `billing_events` |
| Служебное | `change_log`, `push_subscriptions`, `team_notification_prefs`, `webhooks`, `edge_cron_secrets`, `app_settings`, `app_release`, `account_deletion_cleanup`, `partner_files`, `master_ratings`, `master_rating_tokens`, `tenant_loyalty_settings` |

## Миграции

- Новая миграция — файл `supabase/migrations/<YYYYMMDDHHMMSS>_<имя>.sql`.
  Время настоящее и номер уникальный — это сторожит
  `apps/mobile/src/lib/migration-names.test.ts`. Версии в
  `supabase_migrations.schema_migrations` боевой базы с именами файлов не
  совпадают, поэтому `supabase db push` для сверки не годится.
- Накат на боевую — только по явному слову владельца.
- Тело функции, которую меняешь, берётся из живой базы
  (`select pg_get_functiondef('public.<имя>'::regproc)`) или из
  `schema/functions.sql`, если снимок свежий, — а не из старой миграции.
- Черновики, которые не накачены, лежат в `supabase/parked/` с описью.

## Как обновить снимок

Только чтение каталога, ничего не меняет:

```sql
-- функции с правами
select string_agg(pg_get_functiondef(p.oid) || ';', E'\n\n' order by p.proname)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind in ('f','p');

-- политики
select * from pg_policies where schemaname = 'public';

-- триггеры
select pg_get_triggerdef(t.oid) from pg_trigger t
join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and not t.tgisinternal;
```

Таблицы собираются из `pg_attribute` + `pg_constraint` (так снят
`schema/tables.sql`); если доступен `pg_dump --schema-only --schema=public`,
он даёт то же самое одним файлом.
