import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import {
  bookingUrl,
  dayChipWords,
  durationWords,
  isBookingToken,
  parseBookingDays,
  parseBookingPage,
  parseBookingSettings,
} from "./online-booking";

describe("online booking token and url", () => {
  test("token is 10–64 base62 chars", () => {
    assert.equal(isBookingToken("pG0f3mr98WXD"), true);
    assert.equal(isBookingToken("short"), false);
    assert.equal(isBookingToken("bad token; drop"), false);
    assert.equal(isBookingToken(undefined), false);
  });

  test("url is the public /b page", () => {
    assert.equal(bookingUrl("pG0f3mr98WXD"), "https://babun.app/b/pG0f3mr98WXD");
  });
});

describe("parseBookingPage", () => {
  test("open page keeps only well-formed services", () => {
    const page = parseBookingPage({
      state: "open",
      business_name: " AirFix LTD ",
      calendar_name: "Y&D",
      country: "CY",
      logo_url: null,
      services: [{ id: "svc-1", name: "A/C Cleaning", duration: 30 }, { id: "", name: "x" }, "junk"],
    });
    assert.equal(page.state, "open");
    assert.equal(page.businessName, "AirFix LTD");
    assert.deepEqual(page.services, [{ id: "svc-1", name: "A/C Cleaning", duration: 30 }]);
  });

  test("open page without services reads as closed", () => {
    assert.equal(parseBookingPage({ state: "open", services: [] }).state, "closed");
  });

  test("unknown answer is a missing link", () => {
    assert.equal(parseBookingPage(null).state, "missing");
    assert.equal(parseBookingPage({ state: "hacked" }).state, "missing");
  });
});

describe("parseBookingDays", () => {
  test("drops days without times and malformed entries", () => {
    const days = parseBookingDays({
      days: [
        { date: "2026-10-29", times: ["09:00", "9:30", "10:00"] },
        { date: "2026-10-30", times: [] },
        { date: "tomorrow", times: ["10:00"] },
      ],
    });
    assert.deepEqual(days, [{ date: "2026-10-29", times: ["09:00", "10:00"] }]);
  });
});

describe("parseBookingSettings", () => {
  test("off by default and service flags kept", () => {
    const s = parseBookingSettings({
      enabled: false,
      token: null,
      services: [{ id: "svc-1", name: "A", duration: 0, online: true }],
    });
    assert.equal(s.enabled, false);
    assert.equal(s.token, null);
    assert.deepEqual(s.services, [{ id: "svc-1", name: "A", duration: 0, online: true }]);
  });
});

describe("words", () => {
  test("duration", () => {
    assert.equal(durationWords(0), "");
    assert.equal(durationWords(30), "30 мин");
    assert.equal(durationWords(60), "1 ч");
    assert.equal(durationWords(90), "1 ч 30 мин");
  });

  test("day chip", () => {
    assert.deepEqual(dayChipWords("2026-10-30"), { weekday: "Пт", day: "30 окт" });
  });
});

// СТОРОЖ ПУБЛИЧНЫХ ДВЕРЕЙ. Страница без входа обязана знать только токен и не
// отдавать ничего, кроме окон и названий услуг. Сторож читает миграцию как
// текст: цена услуги не уходит наружу, внутренние функции закрыты всем, а
// у anon — ровно три двери.
describe("online booking migration contract", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // До наката файл лежит в `supabase/parked/`, после — в `migrations/`.
  const file = "20261027141700_online_booking.sql";
  const repo = path.resolve(here, "../../../../..");
  const found = ["supabase/migrations", "supabase/parked"]
    .map((dir) => path.join(repo, dir, file))
    .find((p) => existsSync(p));
  assert.ok(found, `нет ${file}`);
  const sql = readFileSync(found, "utf8");
  const body = (name: string): string => {
    const m = new RegExp(`function public\\.${name}\\([\\s\\S]*?\\$function\\$([\\s\\S]*?)\\$function\\$`).exec(sql);
    assert.ok(m, `нет функции ${name}`);
    return m[1];
  };

  test("public page and services carry no price, phone or client", () => {
    for (const name of ["online_booking_page", "online_booking_services", "online_booking_slots"]) {
      assert.doesNotMatch(body(name), /price|phone|client/i, name);
    }
  });

  test("anon gets exactly the three page doors", () => {
    const anonGrants = [...sql.matchAll(/grant execute on function public\.(\w+)\([^)]*\) to anon/g)].map((m) => m[1]);
    assert.deepEqual(anonGrants.sort(), ["online_booking_create", "online_booking_page", "online_booking_slots"]);
    for (const name of [
      "online_booking_hm",
      "online_booking_day_slots",
      "online_booking_resolve",
      "online_booking_services",
      "online_booking_owner_tenant",
    ]) {
      assert.match(sql, new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon, authenticated;`), name);
    }
  });

  test("owner functions refuse everyone but the owner", () => {
    for (const name of ["online_booking_settings", "online_booking_set", "online_booking_set_service"]) {
      assert.match(body(name), /online_booking_owner_tenant\(p_team\)[\s\S]*if v_tenant is null then\s+raise exception/, name);
    }
  });

  test("create rechecks the slot under the calendar lock and limits spam", () => {
    const create = body("online_booking_create");
    const lock = create.indexOf("pg_advisory_xact_lock");
    const recheck = create.indexOf("online_booking_day_slots(");
    assert.ok(lock > 0 && recheck > lock, "окно проверяется под замком");
    assert.match(create, /phone_e164 = v_phone[\s\S]*interval '1 day'\) >= 3/);
    assert.match(create, /interval '1 hour'\) >= 20/);
  });
});

// СТОРОЖ ФИКСА АУДИТА (S-01/S-02): онлайн-заявка не шлёт автоматических SMS
// и не цепляется к чужой карточке по одному номеру.
describe("online booking sms and client match fix", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const file = "20261027213400_online_booking_sms_and_client_match.sql";
  const repo = path.resolve(here, "../../../../..");
  const found = ["supabase/migrations", "supabase/parked"]
    .map((dir) => path.join(repo, dir, file))
    .find((p) => existsSync(p));

  test("sms funnel refuses online bookings", () => {
    assert.ok(found, `нет ${file}`);
    const sql = readFileSync(found, "utf8");
    assert.match(sql, /if a\.source is not distinct from ''online'' then\s+return false;/);
    assert.match(sql, /якорь не найден ровно один раз/);
  });

  test("existing client only on matching first name, otherwise no client, never blacklisted", () => {
    assert.ok(found, `нет ${file}`);
    const sql = readFileSync(found, "utf8");
    assert.match(sql, /if v_match_blocked then\s+raise exception/);
    assert.match(sql, /lower\(split_part\(v_name, ' ', 1\)\) = any\(v_match_names\)/);
    // Номер совпал, имя нет — запись без клиента, заявитель в заметке;
    // второго клиента с тем же номером (без phone_e164) не бывает.
    assert.match(sql, /v_comment := 'Онлайн-запись · ' \|\| v_name \|\| ' · ' \|\| v_phone;/);
    assert.doesNotMatch(sql, /case when v_match is null then v_phone end/);
  });
});
