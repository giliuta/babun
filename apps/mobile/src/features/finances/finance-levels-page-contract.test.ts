import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { readModuleSource } from "@/lib/module-source";
import { financesScreenSource } from "./home/screen-source";

// «ФИНАНСЫ» ПО УРОВНЮ — ПРОВЕРКА ПОДКЛЮЧЕНИЯ (этап 2 доступа).
//
// Само правило проверено своими тестами (`finance-page-access.test.ts`).
// Здесь — что экран его ЗОВЁТ и что ни одна живая кнопка не осталась мимо:
// экраны тянут react-native и под раннером не поднимаются, поэтому проверка
// идёт по исходнику. Верни голый `canEditTransaction(tx)` или убери «Только
// просмотр» — и у сотрудника появится кнопка, которую сервер откажет.

const strip = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
    .replace(/\s+/g, " ");

const read = (rel: string) => strip(readFileSync(join(__dirname, rel), "utf8"));
/** A component entry together with its parts folder. */
const readParts = (rel: string, folder: string) =>
  strip(readModuleSource(join(__dirname, rel), join(__dirname, folder)));

describe("экран «Финансы» спрашивает уровень один раз", () => {
  // The route is layout only; the screen's logic lives in `home/`: read both.
  const index = strip(financesScreenSource());

  test("правило зовётся ровно один раз, ролью и картой прав", () => {
    // Правило знает и функции компании (STORY-088), и кто вошёл: «Добавляет»
    // правит только своё.
    const calls = index.match(
      /financePageAccess\(\{ role, map: myAccessQuery\.data, scope, disabledFeatures, userId, \}\)/g,
    );
    assert.equal(calls?.length, 1);
  });

  test("чипа «Без команды» у сотрудника нет", () => {
    assert.match(index, /const needsNoTeamChip = access\.noTeamChip && \(hasOrphanAccounts \|\| hasTeamless\);/);
  });

  test("шестерёнка денежных настроек серая и глухая", () => {
    // ДВЕРЬ ОТКРЫТА ВСЕМ: шестерёнка больше не серая и не
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
    // ПЛАШКА «ДОКУМЕНТЫ» ОСТАЁТСЯ БЕЗ ДОСТУПА: просто не показываются документы.
    // Тариф её НЕ убирает (всё видно, новое серым):
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
    // Нули — и в сумме, и в разбивке по услугам «Прибыли».
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
    // ПОДСТРАНИЦЫ ШЕСТЕРЁНКИ НЕ ЗАКРЫТЫ ПОИМЁННЫМ СПИСКОМ «ТОЛЬКО ВЛАДЕЛЬЦУ». С правами
    // строки шестерёнки (миграция 20261003235500) каждую подстраницу закрывает дверь её строки
    // (`FinanceSettingsRoute`), а сама шестерёнка не прячется за серой
    // страницей у партнёра без «Доходов» и «Расходов».
    assert.doesNotMatch(layout, /OWNER_ONLY_PATHS/);
    assert.match(layout, /onPath\(pathname, SETTINGS_PATHS\) && anySetting/);
    for (const [file, row] of [
      ["categories.tsx", "row=\\{row\\}"],

      ["deleted.tsx", 'row="trash"'],
    ] as const) {
      const route = read(`../../../app/(dashboard)/finances/${file}`);
      assert.match(route, new RegExp(`<FinanceSettingsRoute ${row}`), `${file} без двери своей строки`);
    }
  });

  test("футер гаснет и называет причину словами", () => {
    const footer = read("FinancesFooter.tsx");
    assert.match(footer, /\{shownReason \? \( <Text/);
    assert.match(footer, /disabled=\{!enabled\}/);
    // «Создать счёт» — своё право (строка шестерёнки «Счета»); 
    // на любой панели, пока у команды нет счёта.
    assert.match(footer, /label="Создать счёт" disabled=\{!create\.enabled\}/);
    assert.match(footer, /const shownReason = creating \? create\.reason : reason;/);
  });

  test("витрина операции рисует только открытые действия", () => {
    const popup = readParts("TransactionPopup.tsx", "transaction-popup");
    assert.match(popup, /const canRefund = \(allow\?\.refund \?\? true\) &&/);
    assert.match(popup, /const canDelete = \(allow\?\.remove \?\? true\) &&/);
    assert.match(popup, /const canInvoice = \(allow\?\.invoice \?\? true\) &&/);
  });

  test("доход по инвойсу возвращают кредит-нотой, а не простым возвратом", () => {
    // Простой возврат без документа снова открывал инвойс долгом.
    const popup = readParts("TransactionPopup.tsx", "transaction-popup");
    const refund = popup.slice(popup.indexOf("const canRefund ="), popup.indexOf("const refundStatusCaption"));
    assert.match(refund, /!tx\.invoice_id &&/);
    // Вкладка — тонкий маршрут; возврат строки живёт в `home/use-row-actions.ts`.
    const screen = financesScreenSource();
    const handler = screen.slice(screen.indexOf("const handleRefund = async"), screen.indexOf("buildRefundDraft(tx, amount"));
    assert.match(handler, /if \(tx\.invoice_id\) \{\s*throw new Error/);
  });

  test("лист долга на «Смотрит»: серое сохранение и без карточки «Ещё»", () => {
    const sheet = readParts("DebtSheet.tsx", "debt-sheet");
    assert.match(sheet, /disabled=\{!canSave \|\| !canWrite\}/);
    assert.match(sheet, /\{!canWrite \? \( <Text/);
    assert.match(sheet, /\{isEdit && debt && canWrite \?/);
  });

  test("дверь на страницу «Счета» закрывается вместе с настройками", () => {
    const panel = read("AccountsPanel.tsx");
    // Дверь несёт команду чипа (`accountsSettingsHref`) — и всё так же
    // закрыта без права настроек.
    assert.match(panel, /onSettings=\{canOpenSettings \? \(\) => onOpen\(accountsSettingsHref\(teamId, NO_TEAM\)\) : undefined\}/);
  });
});
