import type { Href } from "expo-router";
import type { CloseDecision } from "../close-decision";

// ЛИСТ СЧЁТА — ЧИСТЫЕ РЕШЕНИЯ, без экрана.
//
// Владелец 2026-09-15: «когда я нажимаю „Добавить счёт“ — … ещё лучше не
// полноценная страница, а шторка: подымается шторка на 50%, и там можно
// полностью всё редактировать. Я могу также тапнуть на тот же созданный и то
// же самое редактировать уже созданный счёт». Страница настроек счёта ушла в
// этот лист; здесь то, что лист решает, а не рисует.

/** Правка счёта по адресу: страница «Счета» с открытым листом этого счёта.
 *  Старые адреса `/accounts/<id>` и `/accounts/<id>/settings` ведут сюда же. */
export function accountEditHref(id: string): Href {
  return `/accounts/settings?edit=${encodeURIComponent(id)}` as Href;
}

export type EditorView<A> =
  | { kind: "loading" }
  | { kind: "offline" }
  | { kind: "failed"; message: string }
  | { kind: "gone" }
  | { kind: "edit"; account: A };

/** Что показывает лист правки. Ветвление по «данных нет», а не по `isPending`
 *  (§8): без сети запрос стоит в paused и остаётся pending навсегда — лист
 *  крутил бы спиннер вечно. */
export function editorView<A extends { id: string }>(input: {
  accountId: string;
  accounts: readonly A[] | undefined;
  error: Error | null;
  online: boolean;
}): EditorView<A> {
  if (input.accounts === undefined) {
    if (input.error) return { kind: "failed", message: input.error.message };
    return { kind: input.online ? "loading" : "offline" };
  }
  const account = input.accounts.find((a) => a.id === input.accountId);
  return account ? { kind: "edit", account } : { kind: "gone" };
}

/** Что делать после ответа на вопрос о закрытии. Лист на время вопроса
 *  уезжает (из открытого листа вопрос iOS не покажет), поэтому ЛЮБОЙ отказ
 *  обязан вернуть лист — иначе вызывающий считает его открытым, а на экране
 *  пусто, и повторный тап по той же строке ничего не открывает. */
export type AnswerStep = "return" | "delete" | "close" | "transfer" | "trash";

export function stepAfterAnswer(
  decision: CloseDecision | { kind: "trash" },
  confirmed: boolean,
): AnswerStep {
  if (!confirmed || decision.kind === "explain") return "return";
  return decision.kind;
}

