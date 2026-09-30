import type { AccountKind } from "@babun/shared/local/finance/account";

// ТИП СЧЁТА — ПО ЗНАЧКУ, А НЕ ВОПРОСОМ (владелец 2026-09-15: «тип вообще
// убираем»). Человек больше не выбирает «Наличные / Карта / Банк»: он выбирает,
// как счёт выглядит, и этого хватает — значок кассы и значок карты говорят сами
// за себя.
//
// Сам тип при этом живёт в базе и нужен серверу: по нему выводится способ
// оплаты операции (чек печатает «Оплата: наличными»), а оплата заявки ищет
// счёт нужного типа. Поэтому тип задают ТОЛЬКО
// денежные значки словаря (`ICON_PRESETS`). Любой другой значок и пустой выбор
// тип НЕ ТРОГАЮТ (разбор багов счетов 2026-09-15): раньше они превращали счёт в
// «другое», и «Наличные», заведённые без значка, отбивали оплату наличными.
// Новому счёту без значка тип даёт лист создания — касса.
const KIND_BY_ICON: Readonly<Record<string, AccountKind>> = {
  cash: "cash",
  handcoins: "cash",
  wallet: "cash",
  safe: "cash",
  piggy: "cash",
  card: "card",
  bank: "bank",
};

/** Тип по значку: денежный значок называет его сам, остальное оставляет
 *  `fallback` — тип, который у счёта уже есть (или положен новому). */
export function kindForIcon(
  icon: string | null | undefined,
  fallback: AccountKind,
): AccountKind {
  return (icon ? KIND_BY_ICON[icon] : undefined) ?? fallback;
}

/** Слова отказа — по замороженному типу, одной простой фразой: человек слышит,
 *  КАК шли деньги, а не слово «тип» или «денежный значок», которых на экране
 *  нет. Значок не про деньги подходит всегда — об этом молчим: отказ не место
 *  для инструкции. */
const FROZEN_KIND_MESSAGE: Record<AccountKind, string> = {
  cash: "По счёту уже шли наличные — нужен значок наличных.",
  card: "По счёту уже шла оплата картой — нужен значок карты.",
  bank: "По счёту уже шли переводы — нужен значок банка.",
  other: "По счёту уже были операции — значок кассы, карты или банка ему не поставить.",
};

export type IconChange =
  | { ok: true; patch: { icon: string | null; kind?: AccountKind } }
  | { ok: false; title: string; message: string };

/**
 * Смена значка у существующего счёта.
 *
 * ПОКА ОПЕРАЦИЙ НЕТ, тип едет за денежным значком. ПОСЛЕ ПЕРВОЙ ОПЕРАЦИИ тип
 * замораживает сервер (`guard_account_financial_history`), и денежный значок
 * ДРУГОГО типа молча разошёлся бы с ним: плитка с картой, а чек печатает
 * «наличными». Такой значок не пишем и говорим почему — одной фразой; значок
 * того же типа или не денежный меняет только вид.
 */
export function iconChange(
  account: { kind: AccountKind; has_history: boolean },
  slug: string | null,
): IconChange {
  const kind = kindForIcon(slug, account.kind);
  if (kind === account.kind) return { ok: true, patch: { icon: slug } };
  if (account.has_history) {
    return {
      ok: false,
      title: "Значок не подойдёт",
      message: FROZEN_KIND_MESSAGE[account.kind],
    };
  }
  return { ok: true, patch: { icon: slug, kind } };
}
