import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

// КОМАНДА И СЧЁТ В ДЕНЬГАХ ЖИВУТ ТОЛЬКО В `select`.
//
// С 2026-09-15 журнал и долги читаются одним ключом на компанию и период:
// команду ключ больше не называет, её отбирает `select` (`ledger-select.ts`).
// Значит `select` здесь — весь фильтр: удали его — и плитка команды покажет
// деньги всей компании. Заглушка загрузки — вся граница между компаниями:
// верни голый `keepPreviousData` — и под шапкой новой компании встанут деньги
// прошлой. Чистые функции отбора это не ловят: они целы, их просто не зовут.
// Хуки и экран тянут react-native и под раннером не поднимаются, поэтому
// проверка — по исходнику, без комментариев.

const here = __dirname;

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const sourceOf = (rel: string): string =>
  stripComments(readFileSync(join(here, rel), "utf8"));

/** Тело хука до следующего `export`, пробелы схлопнуты. */
function hookBody(source: string, hook: string): string {
  const start = source.search(new RegExp(`export function ${hook}\\(`));
  assert.ok(start >= 0, `нет хука ${hook}`);
  const rest = source.slice(start + 1);
  const end = rest.search(/\nexport /);
  return (end < 0 ? rest : rest.slice(0, end)).replace(/\s+/g, " ");
}

/** Кусок от вызова `useQuery` — объявления `select` и заглушки до него сюда не
 *  попадают, и голые слова в нём ничего не доказывают. */
function useQueryCall(body: string, hook: string): string {
  const at = body.indexOf("useQuery(");
  assert.ok(at >= 0, `${hook} не зовёт useQuery`);
  return body.slice(at);
}

/** Ветка `case` в исполнителе прогрева до следующей ветки или `default`,
 *  пробелы схлопнуты. */
function warmCase(source: string, kind: string): string {
  const start = source.indexOf(`case "${kind}":`);
  assert.ok(start >= 0, `в прогреве нет ветки ${kind}`);
  const rest = source.slice(start + 1);
  const end = rest.search(/\n\s*(case "|default:)/);
  return source
    .slice(start, start + 1 + (end < 0 ? rest.length : end))
    .replace(/\s+/g, " ")
    .trim();
}

const PASSES_SELECT = /\bselect\s*[,}]/;
const PASSES_PLACEHOLDER = /\bplaceholderData\s*[,}]/;

describe("журнал: ключ компании, команда и счёт — select", () => {
  const source = sourceOf("./queries.ts");
  const body = hookBody(source, "useTransactions");

  test("ключ — весь журнал компании за период", () => {
    assert.ok(
      body.includes("queryKey: ledgerRangeKey(tenantId, from, to, null, null)"),
      "useTransactions строит не ключ компании",
    );
  });

  test("отбор и заглушка собраны одним useMemo от компании и среза", () => {
    assert.match(
      body,
      /const \{ select, placeholderData \} = useMemo\( \(\) => \(\{ select: \(rows: FinanceTransaction\[\]\) => pickLedgerRows\(rows, idsFromKey\(teamKey\), idsFromKey\(accountKey\)\), placeholderData: placeholderWithinTenant<FinanceTransaction\[\]>\(tenantId\), \}\), \[tenantId, teamKey, accountKey\], \)/,
    );
    assert.ok(body.includes("const teamKey = idsKey(options.brigadeIds)"));
    assert.ok(body.includes("const accountKey = idsKey(options.accountIds)"));
    assert.match(
      source,
      /import \{[^}]*\bpickLedgerRows\b[^}]*\bplaceholderWithinTenant\b[^}]*\} from "\.\/ledger-select"/,
    );
  });

  test("useQuery получает этот select и эту заглушку, без keepPreviousData", () => {
    const call = useQueryCall(body, "useTransactions");
    assert.match(call, PASSES_SELECT);
    assert.match(call, PASSES_PLACEHOLDER);
    assert.doesNotMatch(source, /\bkeepPreviousData\b/);
  });

  test("сервер читает весь период — без фильтров команды и счёта", () => {
    assert.ok(
      body.includes(
        "queryFn: () => listTransactionsForRange(supabase, tenantId as string, from, to), }",
      ),
      "в чтение журнала вернулся фильтр",
    );
  });
});

describe("долги: ключ компании, команда — select", () => {
  const source = sourceOf("./debts-queries.ts");
  const body = hookBody(source, "useDebts");

  test("ключ — все долги компании за период", () => {
    assert.ok(
      body.includes("queryKey: debtsRangeQueryKey(tenantId, from, to, null)"),
      "useDebts строит не ключ компании",
    );
  });

  test("отбор и заглушка собраны одним useMemo от компании и команды", () => {
    assert.match(
      body,
      /const \{ select, placeholderData \} = useMemo\( \(\) => \(\{ select: \(rows: Debt\[\]\) => pickTeamDebts\(rows, teamId\), placeholderData: placeholderWithinTenant<Debt\[\]>\(tenantId\), \}\), \[tenantId, teamId\], \)/,
    );
    assert.match(
      source,
      /import \{[^}]*\bpickTeamDebts\b[^}]*\bplaceholderWithinTenant\b[^}]*\} from "\.\/ledger-select"/,
    );
  });

  test("useQuery получает этот select и эту заглушку, без keepPreviousData", () => {
    const call = useQueryCall(body, "useDebts");
    assert.match(call, PASSES_SELECT);
    assert.match(call, PASSES_PLACEHOLDER);
    assert.doesNotMatch(source, /\bkeepPreviousData\b/);
  });

  test("сервер читает весь период — без фильтра команды", () => {
    assert.ok(
      body.includes("queryFn: () => listDebts(supabase, tenantId as string, from, to), }"),
      "в чтение долгов вернулся фильтр",
    );
  });

  // Прогрев кладёт ответ под тот же ключ `null`, что и хук: протащи туда
  // `teamId` — и чужие команды увидят «свежие» нули без похода в сеть.
  // Типы это не ловят: `listDebts` честно принимает `{ teamId }`.
  test("прогрев читает долги тем же срезом, что и хук — без команды", () => {
    const prefetch = sourceOf("../../lib/tenant-prefetch.ts");
    assert.equal(
      warmCase(prefetch, "debts"),
      'case "debts": return listDebts(client, tenantId, target.from as string, target.to as string);',
    );
    assert.equal(
      warmCase(prefetch, "debt-paid-totals"),
      'case "debt-paid-totals": return listDebtPaidTotals(client, tenantId);',
    );
  });

  test("суммы платежей — ключом из общего листа", () => {
    assert.ok(
      hookBody(source, "useDebtPaidTotals").includes(
        "queryKey: debtPaidTotalsQueryKey(tenantId)",
      ),
    );
  });
});

describe("экран «Финансы»: гашение, обновление и «Без команды»", () => {
  const source = stripComments(
    readFileSync(join(here, "../../../app/(dashboard)/finances/index.tsx"), "utf8"),
  ).replace(/\s+/g, " ");

  test("гасятся и журнал, и долги на загрузке периода", () => {
    const stale = source.match(/const stale = ([^;]*);/);
    assert.ok(stale, "нет `const stale`");
    // Гасим, пока ХОТЯ БЫ ОДИН из двух ещё на заглушке: с `&&` новый период
    // встанет под подпись незагашенным, если долги доехали раньше журнала.
    assert.equal(
      (stale[1] as string).trim(),
      "transactionsQuery.isPlaceholderData || debtsQuery.isPlaceholderData",
    );
  });

  test("холодная компания: долги и суммы платежей держат гейт загрузки", () => {
    // Заглушка не переходит границу компании, значит на холодном переключении
    // `stale` ложен и вуали нет. Выпади долги из гейта — плитка «Долги»
    // покажет ноль как настоящую цифру, пока не доедет чтение.
    const loading = source.match(/const loading = ([^;]*);/);
    assert.ok(loading, "нет `const loading`");
    const gate = loading[1] as string;
    assert.ok(
      gate.includes("(debtsQuery.isPending && debtsQuery.data === undefined)"),
      "долги выпали из гейта загрузки",
    );
    assert.ok(gate.includes("debtPaidQuery.isPending"), "суммы платежей выпали из гейта загрузки");
  });

  test("ошибка долгов показывает экран ошибки, «Повторить» перечитывает долги", () => {
    // Долги читаются отдельно от журнала: выпади они из loadError — упавшее
    // чтение нарисует правдоподобный ноль в плитке «Долги»; выпади из
    // refreshAll — «Повторить» на экране ошибки их так и не перечитает.
    const loadError = source.match(/const loadError = ([^;]*);/);
    assert.ok(loadError, "нет `const loadError`");
    const errors = loadError[1] as string;
    assert.ok(
      errors.includes("debtsQuery.data === undefined ? debtsQuery.error : null"),
      "ошибка долгов не ведёт на экран ошибки",
    );
    assert.ok(
      errors.includes("debtPaidQuery.data === undefined ? debtPaidQuery.error : null"),
      "ошибка сумм платежей не ведёт на экран ошибки",
    );
    const refresh = source.match(/const refreshAll = \(\) => void Promise\.all\(\[([^\]]*)\]\);/);
    assert.ok(refresh, "нет `const refreshAll`");
    const calls = refresh[1] as string;
    assert.ok(calls.includes("debtsQuery.refetch()"), "«Повторить» не перечитывает долги");
    assert.ok(calls.includes("debtPaidQuery.refetch()"), "«Повторить» не перечитывает суммы платежей");
  });

  test("возврат на таб и жест обновления роняют и долги", () => {
    // Тап по команде больше не перечитывает долги (ключ один на компанию),
    // и реалтайм финансовые таблицы не покрывает: без этого сброса чужие
    // правки долгов доезжали бы только после своей записи.
    const at = source.indexOf("const invalidateLedger = useCallback(");
    assert.ok(at >= 0, "нет invalidateLedger");
    const block = source.slice(at, source.indexOf("[qc]", at));
    assert.ok(block.includes('queryKey: ["debts"]'), "invalidateLedger не роняет долги");
    assert.ok(block.includes('queryKey: ["transactions"]'));
  });

  test("«Без команды» без сирот — ноль строк, а не журнал всей компании", () => {
    // Проверяется вся тернарка, а не наличие литерала: перепутай ветки — и
    // литерал на месте, но при сиротах чип получит ноль строк и потеряет их
    // деньги, а без сирот `accountIds: []` значит «фильтра нет» — журнал всей
    // компании.
    assert.match(
      source,
      /useTransactions\( period\.from, period\.to, scope === NO_TEAM \? orphanAccounts\.length > 0 \? \{ accountIds: orphanAccounts\.map\(\(account\) => account\.id\), \} : \{ brigadeIds: \[NO_TEAM\] \} : \{ brigadeIds: scope \? \[scope\] : undefined \}, \)/,
      "чип «Без команды»: при сиротах — срез по их счетам, без сирот — ноль строк, а не журнал всей компании",
    );
    assert.doesNotMatch(source, /accountIds: orphanAccounts\.map\([^)]*\)[^}]*enabled:/);
  });
});
