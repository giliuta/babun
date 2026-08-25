import type { AccountKind } from "./account";
import type { PaymentMethod } from "./transaction";
import { exactMoneyAmountToCents } from "../../common/utils/money";

const ACCOUNT_KIND_BY_PAYMENT_METHOD: Record<PaymentMethod, AccountKind> = {
  cash: "cash",
  card: "card",
  transfer: "bank",
  other: "other",
};

const PAYMENT_METHOD_BY_ACCOUNT_KIND: Record<AccountKind, PaymentMethod> = {
  cash: "cash",
  card: "card",
  bank: "transfer",
  other: "other",
};

/** Canonical routing shared by finance forms and the database trigger. */
export function accountKindForPaymentMethod(method: PaymentMethod): AccountKind {
  return ACCOUNT_KIND_BY_PAYMENT_METHOD[method];
}

/** Inverse of {@link accountKindForPaymentMethod}: tap an account → method. */
export function paymentMethodForAccountKind(kind: AccountKind): PaymentMethod {
  return PAYMENT_METHOD_BY_ACCOUNT_KIND[kind];
}

export function isPaymentAccountCompatible(
  method: PaymentMethod | null | undefined,
  kind: AccountKind | null | undefined,
): boolean {
  return !!method && !!kind && accountKindForPaymentMethod(method) === kind;
}

/**
 * У СЧЁТА ОДИН ВЛАДЕЛЕЦ — БРИГАДА (владелец 2026-08-15: «общий счёт убираем,
 * счёт создаётся чётко на каждую команду»).
 *
 * Здесь стояли `scope` и `team_ids`: счёт мог принадлежать компании и быть
 * подключённым к нескольким командам. Из этой сущности росло и правило
 * перевода «между командами — только через общий счёт»; ушла она — ушло и оно.
 */
export interface AccountTeamAccess {
  brigade_id: string | null;
}

/** Счёт команды — тот, у которого она записана владельцем. */
export function accountServesTeam(
  account: AccountTeamAccess,
  teamId: string,
): boolean {
  return account.brigade_id === teamId;
}

/**
 * Счета, на которые команда может принимать деньги. Один источник ответа на
 * весь продукт: до него каждый экран фильтровал по-своему.
 *
 * Команды нет (инвойс или шаблон не привязаны к команде) — фильтровать не по
 * чему: отдаём весь список, выбор остаётся за человеком.
 */
export function accountsForTeam<T extends AccountTeamAccess>(
  accounts: readonly T[],
  teamId: string | null | undefined,
): T[] {
  if (!teamId) return [...accounts];
  return accounts.filter((account) => accountServesTeam(account, teamId));
}

export interface TransferAccountSnapshot {
  id: string;
  balance: number;
  is_active: boolean;
}

/**
 * Допустима ли ПАРА счетов — сама по себе, без суммы.
 *
 * ЗАПРЕТА ПЕРЕВОДА МЕЖДУ БРИГАДАМИ БОЛЬШЕ НЕТ (владелец 2026-08-15). Он
 * существовал только ради «общего счёта»: деньги обязаны были идти через счёт,
 * подключённый к обеим командам. Общего счёта нет — деньги идут напрямую, и
 * недопустимых пар остаётся ровно две: счёт сам с собой и закрытый счёт.
 *
 * Функция остаётся отдельной от {@link transferValidationError}: лист перевода
 * спрашивает её ДО набора суммы, а валидатор отправки зовёт её же — правило на
 * продукт одно.
 */
export function transferPairError(
  from: TransferAccountSnapshot,
  to: TransferAccountSnapshot,
): string | null {
  if (!from.is_active || !to.is_active) return "Перевод доступен только между активными счетами";
  if (from.id === to.id) return "Выберите разные счета";
  return null;
}

/**
 * Client-side mirror of the RPC's user-facing transfer checks. The database
 * remains authoritative; this only keeps an invalid form from being sent.
 */
export function transferValidationError(
  from: TransferAccountSnapshot | null | undefined,
  to: TransferAccountSnapshot | null | undefined,
  amount: number,
): string | null {
  if (!from || !to) return "Выберите оба счёта";
  const pair = transferPairError(from, to);
  if (pair) return pair;
  if (exactMoneyAmountToCents(amount) == null) return "Введите сумму больше нуля";
  if (amount > from.balance + 0.000001) return "На исходном счёте недостаточно средств";
  return null;
}

/** Минимальная форма отказа PostgREST/Postgres — больше знать не нужно. */
export interface DatabaseErrorLike {
  code?: string | null;
  message?: string | null;
}

/**
 * Дубль имени счёта (уникальные индексы `ux_accounts_team_name` и
 * `ux_accounts_company_name`). Имя счёта — это ЕДИНСТВЕННОЕ, чем человек
 * различает кассы в формах оплаты, поэтому отказ называет и имя, и владельца,
 * и последствие, а не констатирует «нарушено ограничение».
 */
export function duplicateAccountNameMessage(name: string): string {
  return `Счёт «${name.trim()}» у этой команды уже есть. Выберите другое имя — иначе в формах оплаты будут две одинаковые строки.`;
}

/**
 * Отказ базы → фраза для человека. Сырой Postgres наружу не показываем:
 * «duplicate key value violates unique constraint "ux_accounts_team_name"»
 * не отвечает ни на один вопрос того, кто только что нажал «Готово».
 *
 * Исключение — P0001: так падают наши же guard-триггеры. Они написаны
 * по-русски и знают то, чего клиент не знает («на нём 12 операций»), поэтому
 * их текст сильнее любого нашего.
 */
export function accountWriteErrorMessage(
  error: DatabaseErrorLike | null | undefined,
  texts: { fallback: string; duplicate?: string },
): string {
  if (!error) return texts.fallback;
  if (error.code === "P0001" && error.message) return error.message;
  if (error.code === "23505" && texts.duplicate) return texts.duplicate;
  return texts.fallback;
}
