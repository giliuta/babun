import type { TxVatMode } from "@babun/shared/local/finance/vat";

// КАКОЙ НДС ФОРМА ОПЕРАЦИИ НАЗЫВАЕТ СЕРВЕРУ — И КОГДА МОЛЧИТ.
//
// Молчание и явное «Без НДС» — разные вещи. `fill_transaction_vat` уважает
// присланное `'none'` сильнее любых настроек (это самое сильное правило
// функции), а пустую колонку читает как «решай сам» и берёт режим счёта →
// команды → компании со ставкой команды → компании.
//
// С уровнями финансов (2026-09-15) сотрудник настройки налога не читает:
// `useVatSettings` отказывает, действующий режим сходится в «Без НДС», и
// черновик отправлял бы явное `'none'` — операции компании С НДС легли бы без
// налога и без ставки, молча и необратимо для отчётов. Поэтому: не знаем
// настройку — не называем режим.
//
// Выбор человека сильнее всего: нажатая клавиша НДС уходит как есть. Тот же
// флаг взводит гидрация правки, но у сотрудника клавиш нет, и режим
// существующей строки сервер знает сам — ему нечего сообщать.

export interface DraftVatInput {
  /** Режим, который стоит в форме сейчас. */
  mode: TxVatMode;
  /** Клавишу НДС нажали руками (или форма открыта на существующей операции —
   *  её режим взведён снимком строки). */
  chosen: boolean;
  /** Настройки налога этому человеку вообще доступны: у сотрудника нет ни
   *  клавиш, ни права прочитать настройку. */
  canReadSettings: boolean;
  /** Настройки компании И переопределения команд доехали. */
  settingsKnown: boolean;
}

/**
 * Что положить в `vat_mode` черновика операции. `undefined` — не отправлять
 * колонку вовсе: налог посчитает сервер.
 */
export function vatModeForDraft({
  mode,
  chosen,
  canReadSettings,
  settingsKnown,
}: DraftVatInput): TxVatMode | undefined {
  if (!canReadSettings) return undefined;
  if (chosen) return mode;
  return settingsKnown ? mode : undefined;
}

/**
 * РЕЖИМ VAT НОВОЙ ОПЕРАЦИИ ПО УМОЛЧАНИЮ — С УЧЁТОМ НАПРАВЛЕНИЯ ДЕНЕГ (аудит
 * 2026-09-29: «ввёл €1 — списалось €1,19»).
 *
 * Доход «Плюс VAT» — обычное дело: цену назвали без налога, клиент заплатит
 * сверху. Расход же вводят суммой с чека — тем, что УШЛО со счёта, и «Плюс
 * VAT» по умолчанию молча списывал больше, чем заплатили. Поэтому у расхода
 * настройка «Плюс VAT» становится «VAT включён»; нажатая руками клавиша
 * по-прежнему сильнее умолчания.
 */
export function defaultOperationVatMode(
  settingMode: TxVatMode,
  kind: "income" | "expense",
): TxVatMode {
  return kind === "expense" && settingMode === "exclusive" ? "inclusive" : settingMode;
}

/** Строка-последствие под клавишами VAT — по направлению денег: у дохода
 *  деньги «придут на счёт» и «вам остаются», у расхода — «уйдут со счёта».
 *  `null` — без налога, сказать нечего. */
export function vatConsequenceLine(
  kind: "income" | "expense",
  mode: TxVatMode,
  amounts: { gross: number; vat: number; net: number },
  fmt: (n: number) => string,
): string | null {
  if (mode === "none") return null;
  if (mode === "exclusive") {
    return kind === "expense"
      ? `Со счёта уйдёт ${fmt(amounts.gross)} · налог ${fmt(amounts.vat)}`
      : `На счёт придёт ${fmt(amounts.gross)} · налог ${fmt(amounts.vat)}`;
  }
  return kind === "expense"
    ? `Из них налог ${fmt(amounts.vat)} · без налога ${fmt(amounts.net)}`
    : `Из них налог ${fmt(amounts.vat)} · вам остаётся ${fmt(amounts.net)}`;
}
