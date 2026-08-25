# Finance & Payroll Model — Babun CRM

> ⛔ **АРХИВ. НЕ КАНОН.** Это модель прототипа на localStorage: ключи
> `babun2:finance:*` и «миграции» `0001_seed_brigades` … `0004_service_categories`.
> Ни одного такого ключа в дереве нет — финансы давно живут в Supabase
> (`supabase/migrations/*`: счета, транзакции, НДС, зарплаты; чтение — через
> репозитории `packages/shared/src/db/repositories/*`).
>
> Актуальное состояние домена — `docs/audit/FINANCES-AUDIT-2026-08-16.md` и сами
> миграции. Здесь ценны только формулы и словарь сущностей; любую структуру
> данных перед использованием сверяй со схемой, а не с этим файлом.
>
> Одно правило пережило переезд: все суммы — **целые евроценты** (€50.00 → `5000`).

---

## Entity Map

```
Brigade ──< BrigadeMember >── Master (from masters.ts)
Appointment ──< ServiceLine >── FinanceService >── FinanceServiceCategory
Appointment ──< AppointmentFinance
AppointmentFinance ──< FinancePayment
Brigade ──< Expense (scope=brigade)
Company ──< Expense (scope=company)
Appointment ──< Expense (scope=appointment)
Brigade, period ──> PayrollPeriod ──< PayrollLine
NotificationTemplate (standalone)
```

---

## Types Reference

### AppointmentFinanceStatus
```
"new" | "completed" | "cancelled"
```
No `"paid"` or `"in_progress"` — Bumpix field research confirmed these three only.

### AppointmentSource
```
"manual" | "online" | "waitlist"
```

### ExpenseScope
```
"company" | "brigade" | "appointment"
```
Three levels:
- `company` — overhead not tied to a brigade (office rent, accounting)
- `brigade` — brigade-level cost (car rent €400/mo, lunch €20/day per person)
- `appointment` — materials purchased for a specific job

### BrigadeType
```
"internal" | "outsource"
```
- `internal` — paid base + % of brigade revenue
- `outsource` — fixed `perJobCostCents` per appointment, no base salary

---

## Entities

### FinanceServiceCategory
| Field | Type | Notes |
|---|---|---|
| id | string | |
| label | string | Display name |
| colorHex | string | `#rrggbb` |
| defaultDurationMin | number | Minutes |

Seeded categories (Bumpix catalog):
- A/C Чистка (`cat-fin-cleaning`, `#3b82f6`, 45 min)
- Фреон (`cat-fin-freon`, `#10b981`, 30 min)
- Утечка (`cat-fin-leak`, `#ef4444`, 60 min)
- Монтаж (`cat-fin-install`, `#8b5cf6`, 120 min)
- ВРЕМЯ / Почасовая (`cat-fin-time`, `#f59e0b`, 60 min)
- Сервис / Диагностика (`cat-fin-service`, `#64748b`, 60 min)

### FinanceService
| Field | Type | Notes |
|---|---|---|
| id | string | |
| name | string | |
| categoryId | string | FK → FinanceServiceCategory |
| durationMinutes | number | |
| unitPriceEur | number | **euro-cents** |
| isActive | boolean | |

### ServiceLine
One line in an appointment's invoice. No per-line discount (discount lives on AppointmentFinance).

| Field | Type | Notes |
|---|---|---|
| id | string | |
| serviceId | string | FK → FinanceService |
| quantity | number | |
| unitPriceEur | number | **euro-cents**, actual charged (may differ from catalog) |
| subtotalEur | number | **euro-cents** = qty × unitPriceEur |

### Brigade
| Field | Type | Notes |
|---|---|---|
| id | string | `br_yd`, `br_dk`, `br_george` |
| name | string | |
| type | BrigadeType | `internal` or `outsource` |
| leadMasterId | string \| null | FK → Master.id |
| helperMasterIds | string[] | FK → Master.id[] |
| perJobCostCents | number | **euro-cents**, outsource only |
| isActive | boolean | |
| createdAt | string | ISO |

Seeded brigades:
| id | name | type | lead | helper |
|---|---|---|---|---|
| `br_yd` | Y&D | internal | `m-yura` | `m-danya-yd` |
| `br_dk` | D&K | internal | `m-danya-dk` | `m-kolya` |
| `br_george` | George Install | outsource | null | [] |

### BrigadeMember
Tracks finance-relevant membership (base pay + %). A master can appear in multiple periods.

| Field | Type | Notes |
|---|---|---|
| id | string | |
| masterId | string | FK → Master.id |
| brigadeId | string | FK → Brigade.id |
| role | `"lead" \| "helper"` | |
| baseMonthlySalaryCents | number | **euro-cents** — €1000 = `100000` |
| percentRate | number | 0–100; lead=10, helper=7 |
| joinedAt | string | ISO date |
| leftAt | string \| null | null = current member |

Pay rules:
- Base: €1000/month per person (lead and helper)
- Percent: 10% for lead, 7% for helper — applied to post-discount received amount
- Lunch: €20/day/person → `Expense(scope=brigade)`
- Car rent: €400/month/brigade → `Expense(scope=brigade)`

### AppointmentFinance
Finance record attached to an appointment (1:1).

| Field | Type | Notes |
|---|---|---|
| id | string | |
| appointmentId | string | FK → Appointment.id |
| brigadeId | string \| null | |
| serviceLines | ServiceLine[] | |
| discountPercent | number | 0–100 |
| discountAbsoluteEur | number | **euro-cents** |
| subtotalEur | number | **euro-cents** = Σ(line.subtotalEur) |
| discountEur | number | **euro-cents** = calculated discount amount |
| totalEur | number | **euro-cents** = subtotal − discount |
| outsourceCostTotalEur | number | **euro-cents**, >0 for outsource brigades |
| status | AppointmentFinanceStatus | |
| source | AppointmentSource | |
| completedAt | string \| null | ISO |
| createdAt | string | ISO |

Discount calculation:
```
discountEur = round(subtotalEur * discountPercent / 100) + discountAbsoluteEur
totalEur = subtotalEur - discountEur   (clamped ≥ 0)
```

### FinancePayment
| Field | Type | Notes |
|---|---|---|
| id | string | |
| appointmentId | string | |
| clientId | string \| null | |
| brigadeId | string \| null | |
| amountCents | number | **euro-cents** |
| method | `"cash" \| "card" \| "transfer" \| "split" \| "invoice"` | |
| paidAt | string | ISO |
| note | string | |
| createdAt | string | ISO |

### Expense
| Field | Type | Notes |
|---|---|---|
| id | string | |
| scope | ExpenseScope | |
| brigadeId | string \| null | required when scope=brigade |
| appointmentId | string \| null | required when scope=appointment |
| category | string | `"lunch" \| "car_rent" \| "fuel" \| "supplies" \| "salary" \| "other"` |
| description | string | |
| amountCents | number | **euro-cents** |
| date | string | YYYY-MM-DD |
| createdAt | string | ISO |

### DailyReconciliation
Cash-box end-of-day check per brigade.

| Field | Type | Notes |
|---|---|---|
| id | string | |
| brigadeId | string | |
| date | string | YYYY-MM-DD |
| expectedCashCents | number | **euro-cents** — sum of cash payments |
| actualCashCents | number | **euro-cents** — what was handed in |
| differenceCents | number | **euro-cents** = actual − expected (negative = shortage) |
| appointmentIds | string[] | appointments counted |
| notes | string | |
| createdAt | string | ISO |

### PayrollPeriod
| Field | Type | Notes |
|---|---|---|
| id | string | |
| brigadeId | string | |
| periodStart | string | YYYY-MM-DD |
| periodEnd | string | YYYY-MM-DD |
| type | `"weekly_percent" \| "monthly_base"` | |
| lines | PayrollLine[] | |
| totalCents | number | **euro-cents** |
| status | `"draft" \| "approved" \| "paid"` | |
| approvedAt | string \| null | ISO |
| paidAt | string \| null | ISO |
| createdAt | string | ISO |

### PayrollLine
| Field | Type | Notes |
|---|---|---|
| id | string | |
| periodId | string | FK → PayrollPeriod |
| masterId | string | |
| brigadeId | string | |
| type | `"weekly_percent" \| "monthly_base"` | |
| amountCents | number | **euro-cents** |
| description | string | e.g. "Y&D week 2026-W15 — Юра 10% of €1620" |

Payroll calc example (Y&D week, revenue €1620 post-discount):
```
lead (Юра, 10%):   1620 × 0.10 = €162.00 → 16200 cents
helper (Даня, 7%): 1620 × 0.07 = €113.40 → 11340 cents
```

### NotificationTemplate
| Field | Type | Notes |
|---|---|---|
| id | string | |
| kind | `"reminder" \| "confirmation" \| "followup"` | |
| channel | `"sms" \| "whatsapp" \| "telegram" \| "email"` | |
| templateText | string | see placeholders below |
| offsetHoursBefore | number | hours before appointment |
| enabled | boolean | |
| createdAt | string | ISO |

Supported placeholders: `{clientName}`, `{serviceList}`, `{date}`, `{time}`, `{address}`, `{brigadeName}`, `{totalEur}`

---

## localStorage Keys

| Key | Content |
|---|---|
| `babun2:finance:brigades` | Brigade[] |
| `babun2:finance:payments` | FinancePayment[] |
| `babun2:finance:expenses` | Expense[] |
| `babun2:finance:reconciliations` | DailyReconciliation[] |
| `babun2:finance:payroll_periods` | PayrollPeriod[] |
| `babun2:finance:notification_templates` | NotificationTemplate[] |
| `babun2:finance:appointment_finance` | AppointmentFinance[] |
| `babun2:migrations` | string[] of applied migration IDs |

---

## Migrations

| ID | Description |
|---|---|
| `0001_seed_brigades` | Seed 3 brigades; backfill `brigadeId` on existing appointments (default `br_yd`) |
| `0002_appointment_finance` | Add AppointmentFinance records for existing appointments with dummy defaults |
| `0003_client_salutation` | Add `salutation?: string` to existing clients |
| `0004_service_categories` | Seed FinanceServiceCategory from Bumpix catalog |

---

## Known Open Questions

1. **Discount breakdown of old data** — Historical appointments have a single `discount_amount` but no breakdown into % vs absolute. How to represent in AppointmentFinance?

2. **Week boundaries** — Does the payroll week start Monday (ISO) or Sunday? Affects `generateWeeklyPercent` edge cases.

3. **Role swap mid-week** — If Даня is lead one day and helper another (covering for Юра), how is the % split? One PayrollPeriod per role-segment or a weighted average?

4. **Multi-day jobs spanning brigades** — An installation taking 2 days where brigade changes on day 2: single AppointmentFinance or two? Which brigade gets the revenue?

5. **Даня×2 identity question** — `m-danya-yd` (helper Y&D) and `m-danya-dk` (lead D&K) are modelled as two Master records. If it's the same physical person, how are monthly base salaries summed — one €1000 or two?

6. **Full-load lunch definition** — Does "€20/day lunch" apply only on working days with ≥1 completed appointment, or every calendar day the brigade is active?

7. **Prepayment vs %** — If a client pays a prepayment before the appointment is completed, does the % run on prepayment date or on completion date?

8. **Недостача (cash shortage) handling** — When `DailyReconciliation.differenceCents < 0`, is the shortage deducted from the brigade's next payout or written off? Who approves write-off?

9. **Outsource margin for %** — George Install is paid `perJobCostCents` per job. If we charge the client more, does the margin go into company revenue or is there a separate outsource-margin category?

10. **Refund after payout** — If a client refund is processed after the brigade payout has been marked `paid`, how is the clawback recorded? New negative Expense or a reversal PayrollLine?
