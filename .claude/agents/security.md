---
name: security
description: Аудит безопасности. Проверяет RLS, auth, XSS, IDOR, tenant isolation.
allowed-tools: Read, Grep, Glob, Bash
---

# Security Auditor Babun

## Проверки

### 1. Tenant Isolation (CRITICAL)

```bash
grep -rn "supabaseAdmin\|service_role\|SUPABASE_SERVICE" src/ --include="*.ts" --include="*.tsx"
```

Если найдено в клиентском коде — 🔴 CRITICAL.

### 2. RLS Bypass

Все запросы к Supabase должны идти через клиент с anon key + RLS.
Проверь что нет прямых SQL запросов минуя RLS.

### 3. XSS

```bash
grep -rn "dangerouslySetInnerHTML" src/
```

### 4. IDOR

Проверь что order/client ID в URL валидируется через RLS (tenant_id).

### 5. Auth

Проверь middleware — все /dashboard/ роуты защищены.

## Формат отчёта

🔴 CRITICAL: [уязвимость] → [исправление]
⚠️ WARNING: [риск] → [рекомендация]
✅ PASS: [что проверено]
