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

test("страница «Тариф»: без флага — только бесплатный пробный, без цен и подписки", () => {
  const src = read("features/tariffs/TariffScreen.tsx");
  // Действие в приложении из магазина — лишь пробный, и только своему
  // аккаунту, у которого пробного ещё не было и ничего не оплачено.
  assert.match(src, /const trialOffer = owner && !scope\.foreign && !state\.forever && !state\.paid && !state\.trial && !state\.trialUsed;/);
  assert.match(src, /const action = !CAN_PAY_HERE\s*\?\s*trialOffer\s*\?\s*tariffAction\(state, selected\)\s*:\s*null/);
  assert.match(src, /const showTiers = CAN_PAY_HERE \|\| trialOffer;/);
  // Цены в плитке — только с флагом.
  assert.match(src, /\{CAN_PAY_HERE \? \(\s*<>\s*<Text[^>]*>\s*\{card\.monthly\}/);
  assert.match(src, /\{CAN_PAY_HERE \? \(\s*<Text[^>]*>\s*\{`За год/);
  assert.match(src, /\{CAN_PAY_HERE && owner && state\.paid && !state\.forever \?/);
  assert.match(src, /tariffStatus\(state, periodEnd, CAN_PAY_HERE\)/);
});

test("действие пробного — бесплатное: пока пробного не было, кнопка «Попробовать 14 дней», а не оплата", () => {
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
