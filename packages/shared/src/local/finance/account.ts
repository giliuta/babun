// СЧЁТ — ГДЕ ЛЕЖАТ ДЕНЬГИ БРИГАДЫ.
//
// У счёта ОДИН владелец — команда (`brigade_id`). Общего счёта и «счёта
// компании» в продукте больше нет (владелец 2026-08-15), и ни одна форма
// создания их не заводит: и лист, и веб-мастер жёстко пишут `scope: "team"`.
//
// `scope` и `team_ids` остались ТОЛЬКО чтением старых строк — их читают
// серверные функции денег, и снести колонки можно лишь после того, как новый
// клиент доедет на все телефоны. Новый код на них не опирается.

export type AccountKind = "cash" | "card" | "bank" | "other";
export type AccountScope = "team" | "company";

export interface Account {
  id: string;
  tenant_id: string;
  /** Наследие: живой продукт заводит только "team" (см. шапку). */
  scope: AccountScope;
  /** Владелец счёта. NULL — счёт старой схемы, оставшийся без команды. */
  brigade_id: string | null;
  /** Teams attached to a company account; always [] for scope === "team". */
  team_ids: string[];
  name: string;
  kind: AccountKind;
  owner_master_id: string | null;
  opening_balance: number;
  /** Значок счёта, выбранный человеком: короткий слаг (`ACCOUNT_ICONS`).
   *  null — рисуем глиф по виду счёта. Старые эмодзи веб-мастера читатель
   *  игнорирует так же, как null. */
  icon: string | null;
  /** Цвет счёта из палитры (#RRGGBB). Здесь цвет ОПОЗНАЁТ счёт, а не означает
   *  деньги: денежные цвета продукта — «пришло / ушло / внимание». */
  color: string | null;
  position: number;
  /** Режим НДС по умолчанию для операций этого счёта. null — как у команды
   *  и компании. «Счёт с НДС» — обычная практика: на расчётный приходят
   *  деньги с налогом, а в кассу от частника — без. */
  vat_mode: "off" | "inclusive" | "exclusive" | null;
  /** Основной счёт группы (команды или счетов компании): куда по умолчанию
   *  падают деньги. РАЗВЯЗАН с `position` — порядок строк это чтение, а не
   *  маршрут денег. Уникальность внутри группы держит частичный индекс
   *  `ux_accounts_primary_per_brigade`, поэтому «сделать основным» обязано
   *  сперва снять флаг со старого. */
  is_primary: boolean;
  /**
   * Показывать ли счёт при оплате заявок. Выключенный счёт остаётся в списке,
   * в переводах и в отчётах — он просто перестаёт принимать деньги заявок.
   *
   * Отдельное поле, а не вывод из `kind`: вид счёта из формы создания убран, и
   * вопрос «принимаем ли сюда выручку» стал самостоятельным. Уважают его ОБЕ
   * серверные двери — пикер `list_payment_accounts_safe` и автоподбор
   * `resolve_appointment_finance_account`.
   */
  show_in_payments: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export function accountDisplayName(a: Account, brigadeName?: string): string {
  if (brigadeName) return `${a.name} · ${brigadeName}`;
  return a.name;
}
