import {
  closeDecision,
  closeDecisionAfterTransfer,
  type ClosableAccount,
  type CloseDecision,
} from "../close-decision";
import { routeParam } from "../finance-route";
import { sumAccountBalances } from "../accounts-sections";
import { isUuid } from "@babun/shared/sync/uuid";

// СТРАНИЦА «СЧЕТА» ЗА ШЕСТЕРЁНКОЙ — ЕЁ РЕШЕНИЯ ЧИСТЫМИ ФУНКЦИЯМИ.
//
// Свайп влево — скрыть; счета можно перетаскивать, менять местами; внизу кнопка
// «Добавить счёт». Всё, что страница решает, а не
// рисует, лежит здесь: что ответить на «Скрыть», какой счёт открыть по адресу и
// какую команду предложить новому счёту.

/** Ответ на «Скрыть»: всё, что умеет закрытие, кроме удаления. */
export type HideDecision = Exclude<
  CloseDecision,
  { kind: "delete" }
>;

/**
 * «СКРЫТЬ» — ЭТО ЗАКРЫТЬ, И НИКОГДА НЕ «УДАЛИТЬ».
 *
 * `closeDecision` отвечает «удалить насовсем» счёту без операций: так ведёт
 * себя «Удалить счёт» закрытого счёта в архиве. У свайпа
 * слово одно — «Скрыть», — и за ним не может прятаться безвозвратное удаление:
 * смахнул опечатку, и её уже не вернуть из «Закрытых счетов». Поэтому решение
 * принимается так, будто история у счёта есть: пустой счёт закрывается, а
 * счёт с остатком на начало (операцией он не считается, но сервер закрыть его
 * не даст) ведёт в перевод, как любой другой.
 */
export function hideDecision<A extends ClosableAccount>(
  account: A,
  accounts: readonly A[],
): HideDecision {
  const decision = closeDecision<A>({ ...account, has_history: true }, accounts);
  // С историей удаления не бывает; ветка держит тип, а не поведение.
  return decision.kind === "delete"
    ? { kind: "close" }
    : decision;
}

/**
 * Вопрос после перевода, затеянного ради «Скрыть». Те же правила, что у
 * закрытия из правки (`closeDecisionAfterTransfer`): лист закрыли, ничего не
 * переведя, — молчим; иначе спрашиваем по свежему остатку и без удаления.
 */
export function hideDecisionAfterTransfer<A extends ClosableAccount>(
  before: ClosableAccount,
  fresh: readonly A[] | undefined,
): { account: A; decision: HideDecision } | null {
  const next = closeDecisionAfterTransfer(before, fresh);
  if (!next || !fresh) return null;
  return { account: next.account, decision: hideDecision(next.account, fresh) };
}

/**
 * «УДАЛИТЬ» — ТЕ ЖЕ ШАГИ, ЧТО «СКРЫТЬ», НО В КОНЦЕ СЧЁТ УХОДИТ В «УДАЛЁННЫЕ
 * СЧЕТА». Сервер принимает только пустой счёт
 * (`account_trash_rules`), поэтому деньги сначала уводятся переводом — ровно
 * как у «Скрыть»; ноль — вопрос «Удалить счёт?».
 */
export type TrashDecision = Exclude<HideDecision, { kind: "close" }> | { kind: "trash" };

export function trashDecision<A extends ClosableAccount>(
  account: A,
  accounts: readonly A[],
): TrashDecision {
  const decision = hideDecision(account, accounts);
  return decision.kind === "close" ? { kind: "trash" } : decision;
}

/** Вопрос после перевода, затеянного ради «Удалить», — по свежему остатку. */
export function trashDecisionAfterTransfer<A extends ClosableAccount>(
  before: ClosableAccount,
  fresh: readonly A[] | undefined,
): { account: A; decision: TrashDecision } | null {
  const next = hideDecisionAfterTransfer(before, fresh);
  if (!next) return null;
  return {
    account: next.account,
    decision: next.decision.kind === "close" ? { kind: "trash" } : next.decision,
  };
}


/**
 * Счёт из `?edit=<uuid>`: так на страницу с открытой шторкой правки приводят
 * старый адрес `/accounts/<id>/settings` и лист операции. Только uuid — любое
 * другое значение («new», обрезок ссылки) шторку не открывает: открыть правку
 * несуществующего счёта значит показать пустую форму под чужим именем.
 */
export function accountEditParam(
  param: string | string[] | undefined,
): string | null {
  const value = routeParam(param);
  return value && isUuid(value) ? value : null;
}

/**
 * ТИХАЯ МЕТКА СТРОКИ СЧЁТА — то, что иначе видно только внутри правки:
 * счёт не стоит в оплате записи. «Основного» счёта нет:
 * первым в оплате и первым среди касс стоит тот, что выше в
 * списке, и отдельное слово об этом не нужно.
 */
export function accountRowMark(account: {
  show_in_payments: boolean;
  is_hidden?: boolean;
}): string | null {
  // Скрытый — главное, что про него надо знать; «Не в оплате» у него всегда.
  if (account.is_hidden) return "Скрыт";
  return account.show_in_payments ? null : "Не в оплате";
}

/**
 * Команда нового счёта с этой страницы. Чипа команд здесь нет, поэтому
 * угадывать нечего: единственная живая команда — ей, иначе выбор за шторкой.
 */
export function presetTeamFor(
  teams: readonly { id: string; is_active: boolean }[],
): string | null {
  const live = teams.filter((team) => team.is_active);
  return live.length === 1 ? live[0].id : null;
}

/**
 * Подытог группы счетов — сумма всех её строк, скрытых и закрытых тоже: на
 * странице «Счета» числа обязаны складываться (скрытые здесь видит только
 * владелец). Плитка «Счета» в «Финансах» считает по-своему, без скрытых
 * (`accountsTotal`). Хоть у одного счёта остаток неизвестен (нет права на
 * деньги команды) — подытога нет вовсе, `null`: сумма из выдуманных нулей
 * врала бы.
 */
export function groupBalanceTotal(
  accounts: readonly { balance: number; balance_known: boolean }[],
): number | null {
  if (accounts.some((account) => !account.balance_known)) return null;
  return sumAccountBalances(accounts);
}

/**
 * Оптимистичные позиции после ответа сервера: снимаются у тех счетов, которых
 * больше не касался более поздний перенос. Позиция, оставленная после успеха,
 * перекрывала бы свежую с сервера (порядок поменял другой телефон), а
 * сброшенная вслепую съела бы позицию второго переноса, ещё летящего в сеть.
 */
export function clearSettledMoves(
  moved: Readonly<Record<string, number>>,
  ids: readonly string[],
  latest: ReadonlyMap<string, number>,
  seq: number,
): Record<string, number> {
  const next = { ...moved };
  for (const id of ids) {
    if (latest.get(id) === seq) delete next[id];
  }
  return next;
}
