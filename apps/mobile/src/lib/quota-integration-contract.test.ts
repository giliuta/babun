import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const MOBILE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function source(relative: string): string {
  return readFileSync(path.join(MOBILE_ROOT, relative), "utf8");
}

function ordered(sourceText: string, first: string, second: string): void {
  const firstAt = sourceText.indexOf(first);
  const secondAt = sourceText.indexOf(second);
  assert.ok(firstAt >= 0, `missing ${first}`);
  assert.ok(secondAt > firstAt, `${second} must follow ${first}`);
}

describe("mobile create quota integration", () => {
  test("client and appointment hooks preflight before the cached create", () => {
    const clients = source("src/features/clients/queries.ts");
    const appointments = source("src/features/calendar/mutations.ts");

    ordered(clients, "await preflightQuotaForCreate", "return createClientCached");
    assert.match(clients, /online:\s*isOnline\(\)/);
    assert.match(clients, /isConfirmedNetworkUnavailable/);

    ordered(appointments, "await preflightQuotaForCreate", "return createAppointment");
    assert.match(appointments, /online:\s*isOnline\(\)/);
    assert.match(appointments, /isConfirmedNetworkUnavailable/);
  });

  test("sync runtime and tenant-switch lifetime are tenant-scoped", () => {
    const runtime = source("src/lib/sync-runtime.ts");
    const providers = source("src/providers/AppProviders.tsx");
    // Транзакция смены компании ПЕРЕЕХАЛА из приёма приглашения в
    // `switch-tenant.ts` (2026-09-12): её же зовёт переключатель контуров, а
    // двух способов менять компанию не бывает. Проверяем там, где она живёт
    // теперь, и отдельно — что приглашение не завело себе вторую копию.
    const switching = source("src/features/settings/switch-tenant.ts");
    const invitations = source("src/features/settings/invitations.ts");

    assert.match(runtime, /startSyncRuntime\(tenantId:\s*string\)/);
    assert.match(runtime, /tenantId:\s*opts\.tenantId/);
    assert.match(providers, /startSyncRuntime\(tenantId\)/);
    assert.match(providers, /\[role, tenantId\]/);

    // КОМПАНИЯ МЕНЯЕТСЯ БЕЗ СЕТИ, И ПОРЯДОК ЗДЕСЬ СТОРОЖИТ СМЫСЛ.
    //
    // Прежние строки караулили механику, которой больше нет: паузу
    // синхронизации, `refreshSession` и сверку «сессия не переключилась».
    // Всё трое существовали потому, что активная компания жила в токене и
    // менялась двумя поездками на сервер. Теперь компанию называет заголовок
    // запроса, а сервер подтверждает её членством — ждать нечего, и паузы не
    // нужны: местный кэш не сносится, а строки в нём разложены по компаниям.
    //
    // Сторожим то, что осталось важным:
    ordered(switching, "setActiveTenantId", "await wipeTenantScopedData");
    assert.match(switching, /keepLocalCache:\s*true/);
    // `activate_tenant` живёт, но ТОЛЬКО в фоне: стоит вернуть его на путь
    // экрана — и пять секунд ожидания возвращаются вместе с ним.
    assert.match(switching, /void catchUpTokenClaim\(/);
    assert.ok(
      !/await catchUpTokenClaim\(/.test(switching),
      "догоняющий claim не должен задерживать экран — он в фоне",
    );
    assert.match(invitations, /await switchTenant\(tenantId\)/);
    assert.ok(
      !invitations.includes("activate_tenant"),
      "приглашение не должно звать activate_tenant напрямую — только switchTenant",
    );
  });
});
