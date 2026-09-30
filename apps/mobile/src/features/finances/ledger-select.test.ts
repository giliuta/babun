import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { NO_TEAM } from "./accounts-sections";
import {
  idsFromKey,
  idsKey,
  pickLedgerRows,
  pickTeamDebts,
  placeholderWithinTenant,
} from "./ledger-select";

// ОТБОР НА УСТРОЙСТВЕ ОБЯЗАН СОВПАДАТЬ С ФИЛЬТРОМ ЗАПРОСА, КОТОРЫЙ ОН ЗАМЕНИЛ.
// Справа в каждом тесте — то, что вернул бы прежний узкий запрос на тех же
// строках: `.in("team_id", …)` и `.in("account_id", …)` у журнала,
// `.eq("team_id", …)` у долгов.
//
// Набор повторяет август компании 11365a87: команды A ×4, B ×6, C ×6, две
// строки без команды на счёте C (их сервер под чипом C не отдавал — поэтому у
// чипа 6 строк, а не 8), строка без счёта и строка бесхозного счёта,
// проведённая командой B.

const A = "team-mp8379ea";
const B = "team-mp8qhxe3";
const C = "team-mrnz51gs";
const ACC_A = "acc-a";
const ACC_B = "acc-b";
const ACC_C = "acc-c";
const ORPHAN = "acc-orphan";

type Row = { id: string; team_id: string | null; account_id: string | null };

const rows: Row[] = [
  ...Array.from({ length: 4 }, (_, i) => ({ id: `a${i}`, team_id: A, account_id: ACC_A })),
  ...Array.from({ length: 5 }, (_, i) => ({ id: `b${i}`, team_id: B, account_id: ACC_B })),
  { id: "b-orphan", team_id: B, account_id: ORPHAN },
  ...Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, team_id: C, account_id: ACC_C })),
  { id: "c-no-account", team_id: C, account_id: null },
  { id: "null-1", team_id: null, account_id: ACC_C },
  { id: "null-2", team_id: null, account_id: ACC_C },
];

const ids = (list: { id: string }[]) => list.map((r) => r.id);

describe("журнал: команда и счёт отбираются как на сервере", () => {
  test("без фильтров — тот же массив, все строки, включая строки без команды", () => {
    const picked = pickLedgerRows(rows, null, null);
    assert.equal(picked, rows, "новая ссылка роняла бы мемоизацию экрана");
    assert.equal(picked.length, 18);
  });

  test("пустые списки — тоже «фильтра нет», как `?.length` перед `.in`", () => {
    assert.equal(pickLedgerRows(rows, [], []), rows);
  });

  test("команда C — 6 строк, ни одной без команды", () => {
    const picked = pickLedgerRows(rows, [C], null);
    assert.equal(picked.length, 6);
    assert.ok(picked.every((r) => r.team_id === C));
  });

  test("команды A и B — 10 строк", () => {
    assert.equal(pickLedgerRows(rows, [A, B], null).length, 10);
  });

  test("счёт-сирота — его строка, строка без счёта не проходит", () => {
    assert.deepEqual(ids(pickLedgerRows(rows, null, [ORPHAN])), ["b-orphan"]);
    assert.ok(!ids(pickLedgerRows(rows, null, [ACC_C])).includes("c-no-account"));
    assert.equal(pickLedgerRows(rows, null, [ACC_C]).length, 7);
  });

  test("команда и счёт — нужны оба (AND, а не OR)", () => {
    assert.deepEqual(ids(pickLedgerRows(rows, [B], [ORPHAN])), ["b-orphan"]);
    assert.deepEqual(pickLedgerRows(rows, [A], [ORPHAN]), []);
    assert.deepEqual(pickLedgerRows(rows, ["team-unknown"], null), []);
  });

  test("«Без команды» без сирот — ноль строк, как `.in(\"team_id\", [\"__no_team__\"])`", () => {
    assert.deepEqual(pickLedgerRows(rows, [NO_TEAM], null), []);
  });

  test("порядок строк не меняется", () => {
    const shuffled = [rows[12], rows[0], rows[7], rows[3]] as Row[];
    assert.deepEqual(ids(pickLedgerRows(shuffled, [A, C, B], null)), ids(shuffled));
  });
});

describe("ключ списка id для зависимостей useMemo", () => {
  test("пусто и undefined — «фильтра нет»", () => {
    assert.equal(idsKey([]), "");
    assert.equal(idsKey(undefined), "");
    assert.equal(idsKey(null), "");
    assert.equal(idsFromKey(""), null);
  });

  test("[\"\"] — не то же, что «фильтра нет»: сервер вернул бы ноль строк", () => {
    assert.notEqual(idsKey([""]), "");
    assert.deepEqual(pickLedgerRows(rows, idsFromKey(idsKey([""])), null), []);
  });

  test("туда и обратно — те же id в том же порядке", () => {
    assert.deepEqual(idsFromKey(idsKey([C, A])), [C, A]);
    assert.deepEqual(idsFromKey(idsKey(["a,b"])), ["a,b"]);
  });
});

describe("долги: строго своя команда", () => {
  const debts = [
    { id: "d1", team_id: "t1" },
    { id: "d2", team_id: null },
    { id: "d3", team_id: "t2" },
  ];

  test("без команды — тот же массив всей компании", () => {
    assert.equal(pickTeamDebts(debts, null), debts);
    assert.equal(pickTeamDebts(debts, undefined), debts);
    assert.equal(pickTeamDebts(debts, ""), debts);
  });

  test("команда — только её долги, долг без команды не проходит", () => {
    assert.deepEqual(ids(pickTeamDebts(debts, "t1")), ["d1"]);
  });

  test("«Без команды» — ноль строк, как `.eq(\"team_id\", \"__no_team__\")`", () => {
    assert.deepEqual(pickTeamDebts(debts, NO_TEAM), []);
  });
});

describe("заглушка загрузки не переходит границу компании", () => {
  const T = "11365a87-bef9-4f6c-a030-b15083fe646b";
  const OTHER = "2bc7907e-b149-44a9-92ff-a5e73403031c";
  const prev = [{ id: "x" }];

  test("прошлый ключ своей компании — прошлые строки", () => {
    const pick = placeholderWithinTenant<typeof prev>(T);
    assert.equal(pick(prev, { queryKey: ["transactions", T, "2026-08-01", "2026-08-31", null, null] }), prev);
    assert.equal(pick(prev, { queryKey: ["debts", T, "2026-08-01", "2026-08-31", null] }), prev);
  });

  test("чужая компания, нет прошлого ключа, нет компании — заглушки нет", () => {
    assert.equal(
      placeholderWithinTenant<typeof prev>(T)(prev, { queryKey: ["transactions", OTHER, "a", "b", null, null] }),
      undefined,
    );
    assert.equal(placeholderWithinTenant<typeof prev>(T)(prev, undefined), undefined);
    assert.equal(placeholderWithinTenant<typeof prev>(null)(prev, { queryKey: ["transactions", null] }), undefined);
    assert.equal(placeholderWithinTenant<typeof prev>(undefined)(prev, { queryKey: ["transactions", undefined] }), undefined);
  });
});

// ИЗВЕСТНЫЙ ОСТАТОК (C4 разбора): в кадр перехода в другую компанию `scope`
// ещё держит команду прошлой, пока эффект экрана не позовёт `fallbackScope`.
// Тёплый журнал новой компании в этот кадр отбирается чужой командой — это
// ноль строк (не чужие деньги). Чинить `useLayoutEffect` нельзя: он переставит
// порядок эффектов с `use-finance-route.ts` (регрессия возврата из записи).
// Переход следующего кадра на первую свою команду проверяется в
// `finance-route.test.ts` (`fallbackScope`), не здесь: этот файл не тянет
// маршрут экрана и коммитится без него.
describe("кадр перехода в другую компанию", () => {
  test("команда прошлой компании на строках новой — ноль строк, не чужие деньги", () => {
    const companyB = [
      { id: "b-1", team_id: "team-b1", account_id: "acc-b1" },
      { id: "b-2", team_id: "team-b2", account_id: "acc-b2" },
    ];
    assert.deepEqual(pickLedgerRows(companyB, [A], null), []);
  });
});
