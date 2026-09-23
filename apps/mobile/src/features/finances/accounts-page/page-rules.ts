import {
  closeDecision,
  closeDecisionAfterTransfer,
  type ClosableAccount,
  type CloseDecision,
} from "../close-decision";
import { routeParam } from "../finance-route";

// СТРАНИЦА «СЧЕТА» ЗА ШЕСТЕРЁНКОЙ — ЕЁ РЕШЕНИЯ ЧИСТЫМИ ФУНКЦИЯМИ.
//
// Владелец 2026-09-15: «…и влево свайп — скрыть; и можно их перетаскивать,
// менять местами; внизу кнопка „Добавить счёт“». Всё, что страница решает, а не
// рисует, лежит здесь: что ответить на «Скрыть», какой счёт открыть по адресу и
// какую команду предложить новому счёту.

/** Ответ на «Скрыть»: всё, что умеет закрытие, кроме удаления. */
export type HideDecision<A extends ClosableAccount> = Exclude<
  CloseDecision<A>,
  { kind: "delete" }
>;

/**
 * «СКРЫТЬ» — ЭТО ЗАКРЫТЬ, И НИКОГДА НЕ «УДАЛИТЬ» (разбор 2026-09-15).
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
): HideDecision<A> {
  const decision = closeDecision<A>({ ...account, has_history: true }, accounts);
  // С историей удаления не бывает; ветка держит тип, а не поведение.
  return decision.kind === "delete"
    ? { kind: "close", successor: null }
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
): { account: A; decision: HideDecision<A> } | null {
  const next = closeDecisionAfterTransfer(before, fresh);
  if (!next || !fresh) return null;
  return { account: next.account, decision: hideDecision(next.account, fresh) };
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  return value && UUID.test(value) ? value : null;
}

/**
 * ТИХАЯ МЕТКА СТРОКИ СЧЁТА — то, что иначе видно только внутри правки.
 *
 * Две настройки счёта меняют его поведение молча: «Основной счёт команды»
 * (туда падают деньги, когда счёт не выбрали руками) и «В оплате записи».
 * Со страницы обе неразличимы: пять одинаковых строк, и чтобы вспомнить,
 * какая касса принимает выручку, приходится открывать каждую.
 *
 * Метка одна на строку, и первой идёт НЕОЖИДАННАЯ: счёт, которого нет в
 * оплате записи, — новость, а «основной» — порядок вещей. У единственного
 * счёта команды «Основной» не печатается: выбирать не из чего, и слово
 * сообщало бы только само себя.
 */
export function accountRowMark(
  account: { is_primary: boolean; show_in_payments: boolean },
  groupSize: number,
): string | null {
  if (!account.show_in_payments) return "Не в оплате";
  return account.is_primary && groupSize > 1 ? "Основной" : null;
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
