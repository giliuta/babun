import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { balanceWarning } from "../features/sms/sms-model";
import { tariffAction, tariffStatus } from "../features/tariffs/tiers";

// ОПЛАТА — ТОЛЬКО НА САЙТЕ (владелец 04.10, `pay-here.ts`). Приложение из
// App Store / Google Play с кнопкой на чужую оплату отклоняют, поэтому каждая
// дверь к оплате на телефоне закрыта флагом `CAN_PAY_HERE`, а слова состояния
// не зовут платить.

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf8");

test("флаг — только веб", () => {
  assert.match(read("lib/pay-here.ts"), /export const CAN_PAY_HERE = Platform\.OS === "web";/);
});

test("страница «Тариф»: без флага — только состояние, без выбора, цен и подписки", () => {
  const src = read("features/tariffs/TariffScreen.tsx");
  assert.match(src, /const action = !CAN_PAY_HERE\s*\?\s*null/);
  assert.match(src, /const showTiers = CAN_PAY_HERE;/);
  assert.match(src, /\{CAN_PAY_HERE \? \(\s*<>\s*<Text[^>]*>\s*\{card\.monthly\}/);
  assert.match(src, /\{CAN_PAY_HERE && owner && state\.paid && !state\.forever \?/);
  assert.match(src, /tariffStatus\(state, periodEnd, CAN_PAY_HERE\)/);
});

test("пробный в приложении из магазина включается сам: «Про», свой аккаунт, только владелец, только раз", () => {
  const src = read("features/tariffs/AutoTrial.tsx");
  assert.match(src, /export const AUTO_TRIAL_TIER = "pro" as const;/);
  for (const cond of ["!CAN_PAY_HERE", "scope.viewRole === \"owner\"", "!scope.foreign", "!state.forever", "!state.paid", "!state.trial", "!state.trialUsed"]) {
    assert.ok(src.includes(cond), `AutoTrial без условия ${cond}`);
  }
  assert.match(read("../app/(dashboard)/_layout.tsx"), /<AutoTrial \/>/);
});

test("действие пробного на сайте — бесплатное: пока пробного не было, «Попробовать 14 дней», а не оплата", () => {
  const fresh = { tier: "free", paid: false, forever: false, trial: null, trialUsed: false, pastDue: false } as const;
  assert.deepEqual(tariffAction(fresh, "pro"), { kind: "trial", label: "Попробовать 14 дней" });
});

test("«Оплаты тарифа»: «Управлять подпиской» только с флагом", () => {
  assert.match(read("features/cabinet/TariffPaymentsScreen.tsx"), /\{!CAN_PAY_HERE \|\| !owner \|\|/);
});

test("SMS: пополнение только с флагом, предупреждения — с флагом", () => {
  const screen = read("features/sms/SmsScreen.tsx");
  assert.match(screen, /const canTopUp = CAN_PAY_HERE && \(/);
  assert.match(screen, /visible=\{canTopUp && topupOpen\}/);
  assert.match(screen, /\{CAN_PAY_HERE \? <SmsTariffCard priceCents=\{data\.priceCents\} \/> : null\}/);
  for (const rel of ["features/sms/SmsScreen.tsx", "features/sms/SmsCabinetRow.tsx", "features/sms/SmsTeamScreen.tsx"]) {
    const bare = read(rel).match(/balanceWarning\((data|account\.data)\)/g);
    assert.equal(bare, null, `${rel}: balanceWarning без флага`);
  }
});

test("слова состояния без флага не зовут платить", () => {
  const owner = { balanceCents: 200, freeLeft: 0, monthCents: 0, monthCount: 0, teams: [] };
  const account = { priceCents: 12, owner, senders: { t: "Babun" }, frozen: false } as unknown as Parameters<typeof balanceWarning>[0];
  assert.equal(balanceWarning(account), "Пополните баланс");
  assert.equal(balanceWarning(account, false), "Баланс на исходе");

  const pastDue = { tier: "pro", paid: true, forever: false, trial: null, trialUsed: true, pastDue: true } as const;
  assert.equal(tariffStatus(pastDue, null), "Оплата не прошла — обновите карту");
  assert.equal(tariffStatus(pastDue, null, false), "Оплата не прошла");
});
