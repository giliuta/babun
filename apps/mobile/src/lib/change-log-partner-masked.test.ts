import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, test } from "node:test";

// «ИСТОРИЯ ИЗМЕНЕНИЙ» ПАРТНЁРА. Политика чтения отдавала ему строку журнала
// целиком — с телефоном, заметкой, суммой, адресом и именем клиента в
// подписи записи, даже когда эти блоки у него в команде скрыты. Теперь
// журнал читается только функцией `list_change_log`, которая вырезает поля
// закрытых блоков, а прямое чтение таблицы осталось одному владельцу.

const SRC = join(__dirname, "..");
const MIGRATION = join(
  __dirname,
  "../../../../supabase/migrations/20261018172100_change_log_partner_masked.sql",
);
const sql = existsSync(MIGRATION) ? readFileSync(MIGRATION, "utf8").replace(/\s+/g, " ") : "";

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe("журнал партнёра без полей скрытых блоков", () => {
  test("прямое чтение партнёру закрыто, читает функция", () => {
    assert.ok(sql, "миграции нет");
    assert.match(sql, /drop policy change_log_select_partner on public\.change_log;/);
    assert.match(sql, /create function public\.list_change_log\(/);
    assert.match(sql, /language plpgsql stable security definer/);
    assert.match(sql, /revoke all on function public\.list_change_log\(timestamptz, timestamptz, bigint, uuid, integer\) from public, anon;/);
  });

  test("поле уходит вместе с блоком: контакты, заметка, сумма, адрес, клиент", () => {
    const pairs: [string, string][] = [
      ["'phone', 'whatsapp_phone', 'email'", "k.o ? 'clients.client'"],
      ["when key in ('comment', 'notes') then", "k.o ? 'clients.note'"],
      ["when key = 'client_id' then", "'record.client'"],
      ["'total_amount', 'custom_total', 'discount_amount'", "'record.amount'"],
      ["when key in ('location_id', 'address', 'address_note', 'address_lat', 'address_lng') then", "'record.object'"],
    ];
    for (const [field, block] of pairs) {
      const at = sql.indexOf(field);
      assert.ok(at > 0, field);
      assert.ok(sql.slice(at, at + 400).includes(block), `${field} → ${block}`);
    }
    // Неизвестное поле партнёру не отдаётся.
    assert.match(sql, /else false end when 'clients' then case/);
    // Подпись записи — только при открытых «Клиенте» и «Заметке».
    assert.match(sql, /when p_entity in \('appointments', 'appointment_photos'\) and not \(/);
  });

  test("владелец читает как раньше, маска — только не диспетчеру", () => {
    assert.match(sql, /if v_role = 'owner' then return query select c\.id, c\.team_id, c\.actor_id, c\.actor_name, c\.entity, c\.entity_id, c\.action, c\.label, c\.meta, c\.changes, c\.created_at/);
    assert.match(sql, /v_mask := v_role is distinct from 'dispatcher';/);
  });

  test("приложение читает журнал функцией; таблицу напрямую — только уведомления владельца", () => {
    const direct = files(SRC)
      .filter((f) => /from\("change_log"\)/.test(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f));
    assert.deepEqual(direct, ["features/cabinet/TeamActivityNotifier.tsx"]);
    const notifier = readFileSync(join(SRC, "features/cabinet/TeamActivityNotifier.tsx"), "utf8");
    assert.match(notifier, /if \(role !== "owner" \|\| !tenantId \|\| !me\) return;/);
    const hook = readFileSync(join(SRC, "lib/use-change-log.ts"), "utf8");
    assert.match(hook, /readChangeLog\(/);
  });
});
