import type { AccessBlock, AccessLevel } from "../access-map";
import { visibleLevel, type MasterDraft } from "../master-page/master-draft";
import { offeredBlocks } from "../master-page/rights-copy";

// ИТОГ ПРАВ КОМАНДЫ (владелец 29.09: «чтобы новый пользователь предоставил
// права сотруднику и не переживал»). Строки прав читать долго; итог говорит
// главное человеческими словами: что он видит в записях, что с клиентами,
// что с деньгами и может ли что-то удалить.
//
// Два размера из одних фактов: ФРАЗЫ — в «Итоге» над строками прав; ВЫЖИМКА
// через точку — в строке команды на странице сотрудника, где фразы
// обрезались на третьей строке («…Удаля…»).
//
// На вход — положение блока в команде; `undefined` — права нет в реестре
// (сервер его не держит) — о нём итог молчит.

export type LevelRead = (key: string) => AccessLevel | undefined;

/** «a», «a и b», «a, b и c». */
export function joinRu(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} и ${parts[parts.length - 1]}`;
}

const cap = (text: string) => (text ? text[0]!.toLocaleUpperCase("ru-RU") + text.slice(1) : text);

/** Скрытое в записи — родительным падежом, в порядке страницы записи. */
const RECORD_HIDDEN: readonly [string, string][] = [
  ["record.label", "метки"],
  ["record.client", "клиента"],
  ["record.object", "объекта"],
  ["record.services", "услуг"],
  ["record.amount", "цен"],
  ["record.payment", "оплаты"],
  ["record.files", "файлов"],
];

/** Правки внутри записи: хоть одна — и «только смотрит» было бы неправдой. */
const RECORD_EDITS = ["record.team", "record.label", "record.color", "record.client", "record.object", "record.amount", "record.payment", "record.files"];

interface TeamFacts {
  /** Скрытое в записи, родительным падежом. */
  hidden: string[];
  /** Закрыто всё, что есть в реестре, — перечень из семи «без» не читается. */
  allHidden: boolean;
  /** Дела с записями: «создаёт и переносит записи», «ставит статус». */
  acts: string[];
  /** Правит что-то внутри записи (клиента, оплату, файлы…). */
  edits: boolean;
  /** Клиенты: `undefined` — права нет в реестре. */
  clients: AccessLevel | undefined;
  clientsAll: boolean;
  /** Что с деньгами: «принимает оплату», «видит долги»… */
  money: string[];
  /** Может удалить чужое: записи, долги, переводы, чужие операции. */
  risky: boolean;
  /** Может удалить свою операцию («Добавляет» доходы или расходы). */
  ownDeletes: boolean;
}

/** Глагол стороны денег по ступени (этап 2). */
const SIDE_VERB: Partial<Record<AccessLevel, string>> = { read: "видит", write: "добавляет", full: "правит все" };

/** «видит доходы и расходы» одной фразой, если ступени равны, иначе по
 *  стороне: «видит доходы», «добавляет расходы». */
function sideWords(income: AccessLevel | undefined, expense: AccessLevel | undefined): string[] {
  const inVerb = income ? SIDE_VERB[income] : undefined;
  const exVerb = expense ? SIDE_VERB[expense] : undefined;
  if (inVerb && inVerb === exVerb) return [`${inVerb} доходы и расходы`];
  const out: string[] = [];
  if (inVerb) out.push(`${inVerb} доходы`);
  if (exVerb) out.push(`${exVerb} расходы`);
  return out;
}

function teamFacts(read: LevelRead): TeamFacts {
  const is = (key: string, level: AccessLevel) => read(key) === level;

  const hidden = RECORD_HIDDEN.filter(([key]) => is(key, "off")).map(([, word]) => word);
  const present = RECORD_HIDDEN.filter(([key]) => read(key) !== undefined);
  const verbs: string[] = [];
  if (is("calendar.create", "write")) verbs.push("создаёт");
  if (is("calendar.move", "write")) verbs.push("переносит");
  if (is("calendar.cancel", "write")) verbs.push("отменяет");
  const acts: string[] = verbs.length > 0 ? [`${joinRu(verbs)} записи`] : [];
  if (is("record.status", "write")) acts.push("ставит статус");

  const money: string[] = [];
  if (is("record.payment", "write")) money.push("принимает оплату");
  // Доходы и расходы — два права с этапа 2; реестр до наката знает только
  // общее `finance.operations`, и тогда итог говорит по нему.
  const ops = read("finance.operations");
  const income = read("finance.income");
  const expense = read("finance.expense");
  if (income !== undefined || expense !== undefined) {
    money.push(...sideWords(income, expense));
  } else {
    if (ops === "read") money.push("видит доходы и расходы");
    if (ops === "write") money.push("ведёт доходы и расходы");
  }
  const accounts = read("finance.accounts");
  if (accounts === "read") money.push("видит счета");
  if (accounts === "write") money.push("управляет счетами");
  const debts = read("finance.debts");
  if (debts === "read") money.push("видит долги");
  if (debts === "write") money.push("принимает оплату долгов");

  return {
    hidden,
    allHidden: present.length > 0 && hidden.length === present.length,
    acts,
    edits: RECORD_EDITS.some((key) => is(key, "write")),
    clients: read("clients"),
    clientsAll: read("clients.scope") === "all",
    money,
    risky:
      is("calendar.cancel", "write") ||
      ops === "write" ||
      accounts === "write" ||
      debts === "write" ||
      income === "full" ||
      expense === "full",
    ownDeletes: income === "write" || expense === "write",
  };
}

/** Итог фразами — над строками прав команды. */
export function teamSentence(read: LevelRead): string {
  const f = teamFacts(read);
  const out: string[] = [];

  // «Записи клиентов: Скрыты» — записей команды у него нет вовсе (01.10:
  // строка говорила «только смотрит записи» при закрытых записях).
  if (read("calendar.records") === "off") {
    out.push("Записей команды не видит.");
    out.push(f.money.length > 0 ? `${cap(joinRu(f.money))}.` : "Деньги закрыты.");
    return out.join(" ");
  }

  // Записи: видит всегда (он прикреплён к команде); без чего — и что делает.
  if (f.allHidden) {
    out.push("Видит у записей команды только время и статус.");
  } else if (f.acts.length === 0 && !f.edits) {
    out.push(`Только смотрит записи команды${f.hidden.length > 0 ? ` — без ${joinRu(f.hidden)}` : ""}.`);
  } else {
    out.push(`Видит записи команды${f.hidden.length > 0 ? ` без ${joinRu(f.hidden)}` : " полностью"}.`);
  }
  if (f.acts.length > 0) out.push(`${cap(f.acts.join(", "))}.`);

  // Клиенты — если право есть в реестре.
  if (f.clients === "off") {
    out.push("Базу клиентов не видит.");
  } else if (f.clients !== undefined) {
    const whom = f.clientsAll ? "всех клиентов" : "своих клиентов";
    out.push(`${f.clients === "write" ? "Ведёт" : "Видит"} ${whom}.`);
  }

  // Деньги: что может с оплатой, операциями, счетами и долгами.
  out.push(f.money.length > 0 ? `${cap(joinRu(f.money))}.` : "Деньги закрыты.");

  // Опасное — отдельной фразой, когда его нет: это и хотят услышать. Своя
  // операция на «Добавляет» удаляется — тогда обещание уже, про чужое.
  if (!f.risky) out.push(f.ownDeletes ? "Чужие записи и деньги удалить не может." : "Записи и деньги удалить не может.");

  return out.join(" ");
}

/** Итог выжимкой через точку — строка команды на странице сотрудника. */
export function teamBrief(read: LevelRead): string {
  const f = teamFacts(read);
  const parts: string[] = [];
  if (read("calendar.records") === "off") parts.push("записей не видит");
  else if (f.acts.length > 0) parts.push(f.acts.join(", "));
  else parts.push(f.edits ? "записи не создаёт и не переносит" : "только смотрит записи");
  if (f.clients === "off") parts.push("клиентов не видит");
  else if (f.clients !== undefined) {
    parts.push(`${f.clients === "write" ? "ведёт" : "видит"} ${f.clientsAll ? "всех" : "своих"} клиентов`);
  }
  parts.push(f.money.length > 0 ? joinRu(f.money) : "деньги закрыты");
  // Точка держится за слово слева неразрывным пробелом: перенос не начинает
  // вторую строку с «·».
  return cap(parts.join(" · "));
}

/** Итог человека в одной команде — по черновику (сотрудник, приглашение,
 *  новый мастер читают права одной формой). Свёрнутое читается свёрнутым. */
function draftReader(blocks: readonly AccessBlock[], draft: MasterDraft, teamId: string): LevelRead {
  const shown = visibleLevel(blocks, draft);
  const byKey = new Map(offeredBlocks(blocks).map((block) => [block.key, block]));
  return (key) => {
    const block = byKey.get(key);
    return block ? shown(block, block.scope === "calendar" ? teamId : null) : undefined;
  };
}

/** Выжимка прав человека в команде — для строки команды. */
export function draftTeamBrief(blocks: readonly AccessBlock[], draft: MasterDraft, teamId: string): string {
  return teamBrief(draftReader(blocks, draft, teamId));
}
