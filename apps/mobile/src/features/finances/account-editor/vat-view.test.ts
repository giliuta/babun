import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { VAT_ZERO_RATE_HINT, accountVatView } from "./vat-view";

const summary = (v: { mode: string; rate: number }) => `${v.mode} · ${v.rate}%`;
const loaded = <T,>(data: T) => ({ data, failed: false });
const base = {
  company: loaded({ mode: "inclusive" as const, rate: 19 }),
  overrides: loaded([] as { teamId: string; mode: null; rate: number | null }[]),
  teamId: "t1",
  accountMode: null,
  summary,
};

describe("строка НДС счёта", () => {
  test("пока настройки компании не пришли — не утверждает, что НДС нет", () => {
    const loading = accountVatView({ ...base, company: { data: undefined, failed: false } });
    assert.deepEqual(loading, { kind: "loading" });
    const failed = accountVatView({ ...base, company: { data: undefined, failed: true } });
    assert.deepEqual(failed, { kind: "failed" });
  });

  test("счёт команды ждёт и переопределения команды", () => {
    const view = accountVatView({ ...base, overrides: { data: undefined, failed: false } });
    assert.deepEqual(view, { kind: "loading" });
    const noTeam = accountVatView({
      ...base,
      teamId: null,
      overrides: { data: undefined, failed: false },
    });
    assert.equal(noTeam.kind, "switch");
  });

  test("компания без налога или с нулевой ставкой — «не работает с НДС»", () => {
    const off = accountVatView({ ...base, company: loaded({ mode: "off" as const, rate: 19 }) });
    assert.deepEqual(off, { kind: "company-off" });
    const zero = accountVatView({ ...base, company: loaded({ mode: "inclusive" as const, rate: 0 }) });
    assert.deepEqual(zero, { kind: "company-off" });
  });

  test("нулевая ставка команды — без «· 0%» в подписи", () => {
    const view = accountVatView({
      ...base,
      overrides: loaded([{ teamId: "t1", mode: null, rate: 0 }]),
      accountMode: "on",
    });
    assert.equal(view.kind, "switch");
    const hint = view.kind === "switch" ? view.hint : undefined;
    assert.equal(hint, VAT_ZERO_RATE_HINT);
    assert.doesNotMatch(hint ?? "", /· 0%/);
  });

  test("обычный счёт с НДС — подпись действующего налога; без НДС — без подписи", () => {
    assert.deepEqual(accountVatView(base), {
      kind: "switch",
      value: true,
      hint: "inclusive · 19%",
    });
    assert.deepEqual(accountVatView({ ...base, accountMode: "off" }), {
      kind: "switch",
      value: false,
      hint: undefined,
    });
  });
});
