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
    // С 24.09 (STORY-088) правило знает и функции компании.
    const calls = index.match(
      /financePageAccess\(\{ role, map: myAccessQuery\.data, scope, disabledFeatures \}\)/g,
    );
    assert.equal(calls?.length, 1);
  });

  test("чипа «Без команды» у сотрудника нет", () => {
    assert.match(index, /const needsNoTeamChip = access\.noTeamChip && \(hasOrphanAccounts \|\| hasTeamless\);/);
  });

  test("шестерёнка денежных настроек серая и глухая", () => {
    // ДВЕРЬ ОТКРЫТА ВСЕМ (владелец 20.09): шестерёнка больше не серая и не
    // глухая — страница за ней сама показывает только доступные строки
    // (`finances/settings-rows.ts`). Сторож следит, чтобы её снова не закрыли.
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
    // Тариф её по-прежнему убирает: без оплаченных документов их в продукте
    // нет вовсе, и «Счета» занимают ряд целиком.
    // Выключенная функция компании (STORY-088) убирает плитку так же, как тариф.
    assert.match(index, /showDocuments=\{canUseDocuments && access\.has\.documents\}/);
    assert.match(index, /showAccounts=\{access\.has\.accounts\}/);
    assert.match(index, /showDebts=\{access\.has\.debts\}/);
    assert.match(index, /lockAccounts=\{access\.accounts === "locked"\}/);
    assert.match(index, /lockOps=\{access\.ops === "locked"\}/);
    assert.match(index, /lockDebts=\{access\.debts === "locked"\}/);
  });

  test("деньги из записей считаются только когда человек их видит", () => {
    assert.match(index, /if \(!access\.recordMoney\) return \{ amount: 0, appointmentCount: 0 \};/);
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
  test("НДС, бланк счёта и список документов сотруднику не открываются ссылкой", () => {
    const layout = read("../../../app/(dashboard)/finances/_layout.tsx");
    // «/finances/settings» ушла из списка (владелец 20.09: «я могу зайти
    // туда, но блоков уже внутри шестерёнки не будет»): страница открыта, а
    // строки на ней показывает `finances/settings-rows.ts`. Вторые ступени
    // остались владельческими — к ним ведут строки, которых у сотрудника нет.
    assert.doesNotMatch(layout, /OWNER_ONLY_PATHS = \[[^\]]*"\/finances\/settings"/);
    // СПИСОК ЗАКРЫТ НЕ ПОИМЁННО, А ПРАВИЛОМ: сторожим, что три прежние двери
    // в нём остались и что «/finances/settings» в него не вернулась. Точное
    // перечисление краснело на КАЖДОЙ новой владельческой странице — так
    // 21.09 оно упало на «/finances/requisites», хотя инвариант цел.
    for (const path of ["/finances/vat", "/finances/vat-team", "/finances/invoices"]) {
      assert.match(
        layout,
        new RegExp(`OWNER_ONLY_PATHS = \\[[^\\]]*"${path.replace(/\//g, "\\/")}"`),
        `${path} пропала из владельческих`,
      );
    }
    assert.match(layout, /if \(OWNER_ONLY_PATHS\.some\(\(path\) => pathname === path \|\| pathname\.startsWith\(`\$\{path\}\/`\)\)\) \{ return <Redirect href="\/finances" \/>; \}/);
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
    assert.match(panel, /onSettings=\{canOpenSettings \? \(\) => onOpen\("\/accounts\/settings"\) : undefined\}/);
  });
});
