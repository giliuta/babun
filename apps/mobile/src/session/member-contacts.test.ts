import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { contactsHiddenOf, contactsLocked, parseMemberContacts, withContacts } from "./member-contacts";

describe("номер сотруднику — по одному", () => {
  test("строка владельца без ключа — прежнее поведение, дверь не нужна", () => {
    assert.equal(contactsHiddenOf({ id: "a" }), undefined);
    assert.equal(contactsLocked({ phone: "", contacts_hidden: undefined }), false);
  });

  test("строка сотрудника: null — открыть можно, day/right — нет", () => {
    assert.equal(contactsHiddenOf({ contacts_hidden: null }), null);
    assert.equal(contactsHiddenOf({ contacts_hidden: "day" }), "day");
    assert.equal(contactsHiddenOf({ contacts_hidden: "right" }), "right");
    // 03.10: открытый номер приходит в строке; пустой при `null` — клиент
    // без номера, а не замок с точками.
    assert.equal(contactsLocked({ phone: "", contacts_hidden: null }), false);
    assert.equal(contactsLocked({ phone: "", contacts_hidden: "right" }), true);
    assert.equal(contactsLocked({ phone: "", contacts_hidden: "day" }), true);
  });

  test("отказы приходят ответом", () => {
    for (const status of ["day", "right", "limit"] as const) {
      assert.deepEqual(parseMemberContacts({ status }), { status });
    }
    assert.throws(() => parseMemberContacts({ status: "maybe" }));
    assert.throws(() => parseMemberContacts(null));
  });

  test("открытый номер склеивается поверх строки окна и снимает замок", () => {
    const answer = parseMemberContacts({
      status: "open",
      phone: "+35799123456",
      phone_e164: "+35799123456",
      phones: [{ id: "p1", number: "+35797000000", label: "Жена" }],
      memberships: [{ group_id: "g1", role: "жена" }],
    });
    assert.equal(answer.status, "open");
    if (answer.status !== "open") return;
    const row = { id: "c1", phone: "", contacts_hidden: null } as never;
    const shown = withContacts(row, answer.contacts) as { phone: string; contacts_hidden: unknown; phones: { name: string }[] };
    assert.equal(shown.phone, "+35799123456");
    assert.equal(shown.contacts_hidden, null);
    assert.equal(shown.phones[0]?.name, "");
    assert.equal(contactsLocked(shown as never), false);
  });
});
