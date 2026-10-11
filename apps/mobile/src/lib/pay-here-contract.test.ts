import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { LEGAL_TEXTS, LEGAL_TEXTS_APP } from "../features/legal/legal-texts";
import { balanceWarning } from "../features/sms/sms-model";
import { tariffAction, tariffStatus, tierLine } from "../features/tariffs/tiers";

// ОПЛАТА — ТОЛЬКО НА САЙТЕ (владелец 04.10, `pay-here.ts`). Приложение из
// App Store / Google Play с кнопкой на чужую оплату отклоняют, поэтому каждая
// дверь к оплате на телефоне закрыта флагом `CAN_PAY_HERE`, а слова состояния
// не зовут платить.

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf8");
const readApp = (rel: string) => readFileSync(path.join(SRC, "../app", rel), "utf8");

test("оплата читает один флаг — его и переключают при отказе App Review", () => {
  // 10.10 владелец включил оплату ссылкой на сайт и в приложениях из
  // магазинов; при отказе 3.1.1 флаг возвращают в `Platform.OS === "web"`.
  assert.match(read("lib/pay-here.ts"), /export const CAN_PAY_HERE: boolean = true;/);
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

// ПРОВЕРКА APP STORE 06.10 (3.1.3(f)): в приложении из магазина нет ни
// покупки, ни призыва к ней — в том числе косвенного: кнопки «Тариф» у
// закрытого, отсчёта пробного, счетов Stripe с оплатой, адреса оплаты в
// условиях, страницы возврата из Stripe.

test("закрытое тарифом без флага — спокойная фраза, без кнопки «Тариф»", () => {
  const src = read("features/tariffs/use-tariff.ts");
  assert.match(src, /export const TARIFF_LOCKED_HINT = CAN_PAY_HERE \? "Нужно изменить тариф" : "Недоступно для этого аккаунта";/);
  const nudge = src.slice(src.indexOf("export function useTariffNudge"));
  const guard = nudge.search(/if \(!CAN_PAY_HERE\) \{\s*toast\(TARIFF_LOCKED_HINT, "info"\);\s*return;\s*\}/);
  assert.ok(guard > 0, "useTariffNudge без ветки приложения из магазина");
  assert.ok(nudge.indexOf('label: "Тариф"') > guard, "кнопка «Тариф» раньше проверки флага");
  for (const rel of ["features/tariffs/TariffLocked.tsx", "features/appointments/PaymentTiles.tsx"]) {
    const file = read(rel);
    assert.match(file, /accessibilityHint=\{(dimmed \? )?TARIFF_LOCKED_HINT/, `${rel}: подсказка VoiceOver мимо флага`);
    assert.doesNotMatch(file, /"Нужно изменить тариф"/, `${rel}: «Нужно изменить тариф» мимо флага`);
  }
});

test("тариф без флага — только имя: ни отсчёта пробного, ни «пробный закончился»", () => {
  const trial = { tier: "pro", paid: false, forever: false, trial: { tier: "pro", days: 9 }, trialUsed: true, pastDue: false } as const;
  const over = { tier: "free", paid: false, forever: false, trial: null, trialUsed: true, pastDue: false } as const;
  // Сайт — как было.
  assert.equal(tierLine("pro", { days: 9 }), "Про · пробный, ещё 9 дней");
  assert.equal(tariffStatus(trial, null), "Пробный · ещё 9 дней");
  assert.equal(tariffStatus(over, null), "Пробный закончился");
  // Приложение из магазина.
  assert.equal(tierLine("pro", { days: 9 }, false), "Про");
  assert.equal(tierLine("free", null, false), "Без тарифа");
  for (const state of [trial, over]) {
    assert.doesNotMatch(tariffStatus(state, null, false), /ещё|пробн/i);
  }
  assert.match(read("features/tariffs/TariffRow.tsx"), /tierLine\(state\.tier, state\.trial, CAN_PAY_HERE\)/);
  assert.match(read("features/cabinet/CompanyScreen.tsx"), /tierLine\(tierOf\(tenant\.data\), trialLeft\(tenant\.data\), CAN_PAY_HERE\)/);
});

test("«Оплаты тарифа» (счета Stripe с оплатой) — только с флагом", () => {
  const own = read("features/cabinet/OwnAccountSection.tsx");
  const rows = own.match(/<TariffPaymentsRow\b/g) ?? [];
  const gated = own.match(/\{CAN_PAY_HERE \? \(\s*<>\s*<TariffPaymentsRow\b/g) ?? [];
  assert.ok(rows.length > 0);
  assert.equal(gated.length, rows.length, "OwnAccountSection: строка оплат мимо флага");
  assert.match(read("features/cabinet/InvitedAccounts.tsx"), /if \(CAN_PAY_HERE && seen\(payments\)\) rows\.push\(\{ key: "payments"/);
  assert.match(readApp("(dashboard)/cabinet/payments.tsx"), /if \(!CAN_PAY_HERE\) return <Redirect href="\/cabinet" \/>;/);
});

test("условия без флага — без Stripe и babun.app как места оплаты; на сайте — полные", () => {
  const screen = read("features/legal/LegalScreen.tsx");
  assert.match(screen, /const TEXTS = CAN_PAY_HERE \? LEGAL_TEXTS : LEGAL_TEXTS_APP;/);
  assert.match(screen, /fillLegal\(TEXTS\[doc\]\[lang\]/);
  assert.doesNotMatch(screen, /LEGAL_TEXTS\[doc\]/, "экран читает веб-текст мимо флага");
  for (const lang of ["ru", "en"] as const) {
    assert.doesNotMatch(LEGAL_TEXTS_APP.terms[lang], /Stripe|на сайте|on babun\.app|on the website/);
    assert.match(LEGAL_TEXTS.terms[lang], /Stripe/);
  }
});

test("регистрация без флага открывает условия своим экраном, а не сайт с полным текстом", () => {
  // babun.app/terms в Safari — веб-сборка с флагом, там `LEGAL_TEXTS` со Stripe.
  const src = readApp("(auth)/register.tsx");
  assert.match(src, /const openLegal = \(href: "\/terms" \| "\/privacy"\) => \{\s*if \(!CAN_PAY_HERE\) \{\s*router\.push\(href\);\s*return;\s*\}/);
  assert.match(src, /onPress=\{\(\) => openLegal\("\/terms"\)\}/);
  assert.match(src, /onPress=\{\(\) => openLegal\("\/privacy"\)\}/);
  assert.doesNotMatch(src, /babun\.app\/(terms|privacy)/, "регистрация открывает сайт мимо флага");
  for (const doc of ["terms", "privacy"]) {
    assert.match(readApp(`${doc}.tsx`), new RegExp(`<LegalScreen doc="${doc}" />`));
  }
});

test("возврат из Stripe без флага не открывается: /pay/done — на главную, ?topup= молчит", () => {
  const done = readApp("pay/done.tsx");
  assert.match(done, /export default function PayDoneRoute\(\) \{\s*if \(!CAN_PAY_HERE\) return <Redirect href="\/" \/>;\s*return <PayDone \/>;/);
  const sms = read("features/sms/SmsScreen.tsx");
  assert.match(sms, /const topupReturn = CAN_PAY_HERE \? params\.topup : undefined;/);
  assert.doesNotMatch(sms, /params\.topup ===/, "SmsScreen читает ?topup= мимо флага");
});


test("регистрация читает один флаг — его и переключают при отказе App Review", () => {
  // «Регистрация аккаунта для бизнеса — доступ к внешней оплате; уберите её».
  // 10.10 владелец включил полную регистрацию и на iPhone; при отказе 3.1.1
  // флаг возвращают в `Platform.OS !== "ios"`.
  assert.match(read("lib/pay-here.ts"), /export const CAN_SIGN_UP_HERE: boolean = true;/);
  // Единая страница входа (09.10): ссылки на регистрацию нет, а новый аккаунт
  // почтой заводится только при CAN_SIGN_UP_HERE или по приглашению.
  const login = readApp("(auth)/login.tsx");
  assert.doesNotMatch(login, /"\/register"/);
  assert.match(login, /const mayCreate =\s*CAN_SIGN_UP_HERE \|\| !!\(await getPendingInvitationToken\(\)/);
  // Вход через Apple/Google создаёт пользователя сам — «Почти готово» на
  // iPhone пускает дальше только по приглашению или в чужую команду.
  const finish = readApp("(auth)/finish-signup.tsx");
  assert.match(finish, /canSignUpHere: CAN_SIGN_UP_HERE/);
  assert.match(finish, /if \(!allowed\) \{/);
  const register = readApp("(auth)/register.tsx");
  assert.match(register, /export default function RegisterRoute\(\)/);
  assert.match(register, /if \(!allowed\) return <Redirect href="\/login" \/>;/);
  assert.match(register, /getPendingInvitationToken\(\)/);
});
