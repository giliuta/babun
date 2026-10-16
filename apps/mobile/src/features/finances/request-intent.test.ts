import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createRequestIntent, draftIntentKey } from "./request-intent";

/** Предсказуемые id вместо uuid: тесту важно РАЗЛИЧИЕ, а не случайность. */
function counter(): () => string {
  let n = 0;
  return () => `id-${++n}`;
}

const draft = { type: "expense", amount: 50, account_id: "a", occurred_on: "2026-10-16" };

describe("createRequestIntent — повтор дедупится, правка честно новая", () => {
  test("повтор без правок после потерянного ответа — тот же id", () => {
    const intent = createRequestIntent(counter());
    assert.equal(intent.idFor(draftIntentKey(draft)), "id-1");
    assert.equal(intent.idFor(draftIntentKey(draft)), "id-1");
  });

  test("поправили сумму перед повтором — новый id, а не «добавлено» со старой", () => {
    const intent = createRequestIntent(counter());
    assert.equal(intent.idFor(draftIntentKey(draft)), "id-1");
    assert.equal(intent.idFor(draftIntentKey({ ...draft, amount: 60 })), "id-2");
  });

  test("после done() те же поля — уже новое намерение", () => {
    const intent = createRequestIntent(counter());
    assert.equal(intent.idFor("k"), "id-1");
    intent.done();
    assert.equal(intent.idFor("k"), "id-2");
  });
});

describe("draftIntentKey", () => {
  test("порядок сборки объекта ключ не меняет", () => {
    assert.equal(
      draftIntentKey({ a: 1, b: "x" }),
      draftIntentKey({ b: "x", a: 1 }),
    );
  });

  test("каждое поле меняет ключ, пусто и null — одно и то же", () => {
    const base = draftIntentKey(draft);
    assert.notEqual(draftIntentKey({ ...draft, account_id: "b" }), base);
    assert.notEqual(draftIntentKey({ ...draft, occurred_on: "2026-10-15" }), base);
    assert.notEqual(draftIntentKey({ ...draft, notes: "чек" }), base);
    assert.equal(draftIntentKey({ x: undefined }), draftIntentKey({ x: null }));
  });
});
