import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

// «ФИНАНСЫ» ПО УРОВНЮ — ПРОВЕРКА ПОДКЛЮЧЕНИЯ (этап 2 доступа).
//
// Само правило проверено своими тестами (`finance-page-access.test.ts`).
// Здесь — что экран его ЗОВЁТ и что ни одна живая кнопка не осталась мимо:
// экраны тянут react-native и под раннером не поднимаются, поэтому проверка
// идёт по исходнику. Верни голый `canEditTransaction(tx)` или убери «Только
// просмотр» — и у сотрудника появится кнопка, которую сервер откажет.

const read = (rel: string) =>
  readFileSync(join(__dirname, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
    .replace(/\s+/g, " ");

const INDEX = "../../../app/(dashboard)/finances/index.tsx";

describe("экран «Финансы» спрашивает уровень один раз", () => {
  const index = read(INDEX);

  test("правило зовётся ровно один раз, ролью и картой прав", () => {
    // С 24.09 (STORY-088) правило знает и функции компании, с 29.09 (срез 2а)
    // — кто вошёл: «Добавляет» правит только своё.
    const calls = index.match(
      /financePageAccess\(\{ role, map: myAccessQuery\.data, scope, disabledFeatures, userId, \}\)/g,
    );
    assert.equal(calls?.length, 1);
  });

  test("чипа «Без команды» у сотрудника нет", () => {
    assert.match(index, /const needsNoTeamChip = access\.noTeamChip && \(hasOrphanAccounts \|\| hasTeamless\);/);
  });

  test("шестерёнка денежных настроек серая и глухая", () => {
    // ДВЕРЬ ОТКРЫТА ВСЕМ (владелец 20.09): шестерёнка больше не серая и не
    // глухая — страница за ней сама показывает только доступные строки
    // (`finances/settings-levels.ts`). Сторож следит, чтобы её снова не закрыли.
    assert.doesNotMatch(index, /disabled=\{!access\.settings\}/);
    assert.doesNotMatch(index, /accessibilityState=\{\{ disabled: !access\.settings \}\}/);
    assert.match(index, /<Settings color=\{t\.sub\} size=\{21\}/);
  });

  test("поиск не принимает ввод без ленты", () => {
    assert.match(index, /editable=\{access\.search\}/);
  });

  test("плитки гаснут по своим блокам, документы — владельческие", () => {
    assert.match(index, /totals=\{shownTotals\}/);
    assert.match(index, /accounts=\{access\.accounts === "locked" \? \{ total: 0 \} : accountsSummary\}/);
    // ПЛАШКА «ДОКУМЕНТЫ» ОСТАЁТСЯ БЕЗ ДОСТУПА (владелец 20.09: «всё равно
    // остаётся плашка „Документы“, и там просто не показываются документы»).
    // С 1.10 тариф её НЕ убирает (владелец: «всё видно, новое серым»):
    // плитка на месте, серая, тап — плашка «Нужно изменить тариф».
    // Выключенная функция компании (STORY-088) по-прежнему убирает плитку.
    assert.match(index, /showDocuments=\{access\.has\.documents\}/);
    assert.match(index, /documentsTariffLocked=\{!canUseDocuments\}/);
    assert.match(index, /showAccounts=\{access\.has\.accounts\}/);
    assert.match(index, /showDebts=\{access\.has\.debts\}/);
    assert.match(index, /lockAccounts=\{access\.accounts === "locked"\}/);
    assert.match(index, /lockIncome=\{access\.income === "locked"\}/);
    assert.match(index, /lockExpense=\{access\.expense === "locked"\}/);
    assert.match(index, /lockDebts=\{access\.debts === "locked"\}/);
  });

  test("деньги из записей считаются только когда человек их видит", () => {
    // Нули — и в сумме, и в разбивке по услугам «Прибыли» (30.09).
    assert.match(
      index,
      /if \(!access\.recordMoney\) \{ return \{ amount: 0, appointmentCount: 0, byService: new Map<string, number>\(\) \}; \}/,
    );
    assert.match(index, /for \(const a of access\.recordMoney \? scopedAppointments : \[\]\)/);
    assert.match(index, /appointments=\{access\.recordMoney \? scopedAppointments : \[\]\}/);
    assert.match(index, /\.\.\.\(access\.recordMoney \? debtRows\(/);
  });

  test("строка открывается на правку по уровню своего календаря", () => {
    assert.match(index, /if \( access\.txEditable\(tx, \{ account: allAccounts\.find/);
    assert.doesNotMatch(index, /if \(canEditTransaction\(tx\)\)/);
  });

  test("главное действие и листы получают ответ правила", () => {
    assert.match(index, /enabled=\{access\.footer\(view\)\.enabled\}/);
    assert.match(index, /reason=\{access\.footer\(view\)\.reason\}/);
    assert.match(index, /allow=\{\{ refund: access\.refunds, invoice: access\.documents, remove:/);
    assert.match(index, /canWrite=\{ editingTx \? access\.txEditable\(editingTx/);
    assert.match(index, /canWrite=\{editingDebt \? access\.debtEditable\(editingDebt\) : access\.debts === "write"\}/);
    assert.match(index, /canOpenSettings=\{access\.settings\}/);
  });
});

describe("двери и подписи по уровню", () => {
  test("подстраницы шестерёнки открываются правом своей строки, а не ролью", () => {
    const layout = read("../../../app/(dashboard)/finances/_layout.tsx");
    // ДО 03.10 подстраницы шестерёнки были «только владельцу» поимённым
    // списком. С правами строк шестерёнки (миграция 20261003235500) список
    // снят: каждую подстраницу закрывает дверь её строки
    // (`FinanceSettingsRoute`), а сама шестерёнка не прячется за серой
    // страницей у партнёра без «Доходов» и «Расходов».
    assert.doesNotMatch(layout, /OWNER_ONLY_PATHS/);
    assert.match(layout, /onPath\(pathname, SETTINGS_PATHS\) && anySetting/);
    for (const [file, row] of [
      ["categories.tsx", "row=\\{row\\}"],
      ["requisites.tsx", 'row="requisites"'],
      ["invoice-blank.tsx", 'row="invoices"'],
      ["deleted.tsx", 'row="trash"'],
    ] as const) {
      const route = read(`../../../app/(dashboard)/finances/${file}`);
      assert.match(route, new RegExp(`<FinanceSettingsRoute ${row}`), `${file} без двери своей строки`);
    }
  });

  test("футер гаснет и называет причину словами", () => {
    const footer = read("FinancesFooter.tsx");
    assert.match(footer, /\{reason \? \( <Text/);
    assert.match(footer, /disabled=\{!enabled\}/);
  });

  test("витрина операции рисует только открытые действия", () => {
    const popup = read("TransactionPopup.tsx");
    assert.match(popup, /const canRefund = \(allow\?\.refund \?\? true\) &&/);
    assert.match(popup, /const canDelete = \(allow\?\.remove \?\? true\) &&/);
    assert.match(popup, /const canInvoice = \(allow\?\.invoice \?\? true\) &&/);
  });

  test("лист долга на «Смотрит»: серое сохранение и без карточки «Ещё»", () => {
    const sheet = read("DebtSheet.tsx");
    assert.match(sheet, /disabled=\{!canSave \|\| !canWrite\}/);
    assert.match(sheet, /\{!canWrite \? \( <Text/);
    assert.match(sheet, /\{isEdit && debt && canWrite \?/);
  });

  test("дверь на страницу «Счета» закрывается вместе с настройками", () => {
    const panel = read("AccountsPanel.tsx");
    // 03.10: дверь несёт команду чипа (`accountsSettingsHref`) — и всё так же
    // закрыта без права настроек.
    assert.match(panel, /onSettings=\{canOpenSettings \? \(\) => onOpen\(accountsSettingsHref\(teamId, NO_TEAM\)\) : undefined\}/);
  });
});
