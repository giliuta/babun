import type { Database, Json } from "@babun/shared/db/database.types";
import { STATUS_LABELS, getPaidAmount, type Appointment } from "@babun/shared/local/appointments";
import { ACQUISITION_LABELS } from "@babun/shared/local/clients";
import { TX_TYPE_LABEL } from "@babun/shared/local/finance/transaction";
import { csvAmount } from "@/lib/csv-amount";
import { csvCell, csvDocument, csvTextCell } from "@/lib/share-csv";

// ВЫГРУЗКА ВСЕХ ДАННЫХ (Кабинет, владелец 03.10: «выгрузить все данные можно,
// но только из своих личных команд, нельзя выгрузить, допустим, с какой-то
// другой командой»).
//
// Здесь только чистая часть: превратить прочитанные строки в CSV и назвать
// файл. Чтение базы и «Поделиться» — в `use-data-export.ts`, право — там же.
//
// ФОРМАТ (был общим с выгрузкой для бухгалтера, удалённой 03.10):
// разделитель «;», BOM, CRLF, суммы числами с запятой («1234,50»). Excel с
// русской или кипрской локалью открывает файл сразу, а сумму можно сложить.
// Текст пользователя (имена, заметки, адреса) проходит `csvTextCell`: ячейка,
// начатая с «=», «+», «-» или «@», иначе исполнилась бы как формула.
//
// ДАТЫ — КАК ЛЕЖАТ В БАЗЕ, `ГГГГ-ММ-ДД`: Excel читает их датой при любой
// локали, а по алфавиту они совпадают с хронологией.

type Row<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

export type ExportKind = "clients" | "appointments" | "finances";

export const EXPORT_KINDS: readonly ExportKind[] = ["clients", "appointments", "finances"];

// ─── Строки, которые читает хук (колонки — те же, что в его select) ─────────

export type ClientExportRow = Pick<
  Row<"clients">,
  | "id"
  | "full_name"
  | "phone"
  | "email"
  | "team_id"
  | "city"
  | "acquisition_source"
  | "birthday"
  | "comment"
  | "notes"
  | "created_at"
>;

export type AppointmentExportRow = Pick<
  Row<"appointments">,
  | "id"
  | "date"
  | "time_start"
  | "time_end"
  | "kind"
  | "team_id"
  | "client_id"
  | "status"
  | "services"
  | "total_amount"
  | "paid_amount"
  | "prepaid_amount"
  | "payment_status"
  | "payments"
  | "payment"
  | "address"
  | "comment"
  | "event_notes"
>;

export type TransactionExportRow = Pick<
  Row<"finance_transactions">,
  | "id"
  | "type"
  | "amount"
  | "occurred_on"
  | "occurred_time"
  | "category_id"
  | "account_id"
  | "team_id"
  | "client_id"
  | "notes"
  | "vat_amount"
  | "vat_mode"
  | "created_at"
>;

export type SourceRef = Pick<Row<"client_sources">, "id" | "name" | "key" | "team_id">;

/** Счёт с командой, на которую он записан: по нему находятся операции без
 *  команды (см. `financeTeamFilter`). */
export type AccountRef = Pick<Row<"accounts">, "id" | "name" | "brigade_id">;

type Names = ReadonlyMap<string, string>;

// ─── Мелочи ─────────────────────────────────────────────────────────────────

function nameOf(names: Names, id: string | null | undefined): string {
  return id ? (names.get(id) ?? "") : "";
}

/** Слово словаря по ключу из базы. Ключа в словаре нет — печатаем сырое
 *  значение: выдумывать слово за незнакомый статус нельзя. `hasOwn`, а не
 *  индекс: значение «constructor» иначе вернуло бы функцию. */
function word(dictionary: Readonly<Record<string, string>>, key: string): string {
  return Object.prototype.hasOwnProperty.call(dictionary, key) ? dictionary[key] : key;
}

/** ЗАМЕТКА КЛИЕНТА — ВСЕ ЕГО ЗАМЕТКИ (аудит Кабинета 03.10). С 06.09 они
 *  живут списком `notes[]`; старое поле `comment` держит только текст из
 *  импорта. Выгрузка читала одно `comment`, и всё, что набрано в карточке
 *  или в записи, уходило пустой ячейкой. Порядок — как писали, каждая
 *  заметка своей строкой; текст импорта, если он не повторён заметкой, —
 *  первым. */
export function clientNotesText(c: Pick<ClientExportRow, "comment" | "notes">): string {
  const list = Array.isArray(c.notes) ? (c.notes as unknown[]) : [];
  const texts = list
    .map((n) => (n && typeof n === "object" ? (n as { text?: unknown; created_at?: unknown }) : {}))
    .filter((n): n is { text: string; created_at?: unknown } => typeof n.text === "string" && n.text.trim() !== "")
    .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")))
    .map((n) => n.text.trim());
  const legacy = (c.comment ?? "").trim();
  if (legacy && !texts.includes(legacy)) texts.unshift(legacy);
  return texts.join("\n");
}

/** `14:30:00` → `14:30`. */
function hoursMinutes(time: string | null | undefined): string {
  return time ? time.slice(0, 5) : "";
}

const compareText = (a: string, b: string) => a.localeCompare(b, "ru");

// ─── Клиенты ────────────────────────────────────────────────────────────────

const CLIENT_HEADER = [
  "Имя",
  "Телефон",
  "Почта",
  "Команда",
  "Метка",
  "Источник",
  "День рождения",
  "Заметка",
  "Создан",
] as const;

/** ИСТОЧНИК КЛИЕНТА СЛОВОМ, А НЕ КЛЮЧОМ.
 *   • `src:<id>` — свой источник команды: имя из `client_sources`; удалённый
 *     источник не назвать, и ячейка пустая (id в таблице бухгалтеру ни к чему);
 *   • старый ключ (`instagram`, `referral`…) — источник ЭТОЙ команды с тем же
 *     `key`, иначе готовое слово из `ACQUISITION_LABELS`; ключа нет и там —
 *     печатаем его как есть;
 *   • `unknown` и пусто — «не знаем», ячейка пустая. */
export function sourceName(
  value: string | null | undefined,
  teamId: string | null,
  sources: readonly SourceRef[],
): string {
  const v = (value ?? "").trim();
  if (!v || v === "unknown") return "";
  if (v.startsWith("src:")) {
    const id = v.slice("src:".length);
    return sources.find((s) => s.id === id)?.name ?? "";
  }
  const own = teamId
    ? sources.find((s) => s.team_id === teamId && s.key === v)
    : undefined;
  return own?.name ?? word(ACQUISITION_LABELS, v);
}

export function clientsToCsv(
  clients: readonly ClientExportRow[],
  refs: { teams: Names; sources: readonly SourceRef[] },
): string {
  const sorted = [...clients].sort(
    (a, b) => compareText(a.full_name, b.full_name) || a.created_at.localeCompare(b.created_at),
  );
  const rows: string[][] = [CLIENT_HEADER.map((h) => csvCell(h))];
  for (const c of sorted) {
    rows.push([
      csvTextCell(c.full_name),
      csvTextCell(c.phone),
      csvTextCell(c.email),
      csvTextCell(nameOf(refs.teams, c.team_id)),
      csvTextCell(c.city),
      csvTextCell(sourceName(c.acquisition_source, c.team_id, refs.sources)),
      csvTextCell(c.birthday),
      csvTextCell(clientNotesText(c)),
      // День создания — по часам телефона, как дата в имени файла: срез
      // строки давал UTC, и клиент, заведённый в 01:30 на Кипре, числился
      // вчерашним (аудит Кабинета 03.10).
      csvCell(c.created_at ? dateStamp(new Date(c.created_at)) : ""),
    ]);
  }
  return csvDocument(rows);
}

// ─── Записи ─────────────────────────────────────────────────────────────────

const APPOINTMENT_HEADER = [
  "Дата",
  "Начало",
  "Конец",
  "Вид",
  "Команда",
  "Клиент",
  "Статус",
  "Услуги",
  "Сумма",
  "Оплачено",
  "Адрес",
  "Заметка",
] as const;

/** Работа — «Запись», любое личное дело в календаре — «Событие». */
function kindWord(kind: string): string {
  if (kind === "work") return "Запись";
  if (kind === "event" || kind === "personal") return "Событие";
  return kind;
}

/** Имена услуг записи. Имя на день записи лежит в самой строке
 *  (`serviceName`); у записей старше 2026-08-25 его нет — тогда из
 *  справочника по `serviceId`. Ни там, ни там — услугу пропускаем. */
export function serviceNames(services: Json, catalog: Names): string {
  if (!Array.isArray(services)) return "";
  const names: string[] = [];
  for (const item of services) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const saved = typeof item.serviceName === "string" ? item.serviceName.trim() : "";
    const id = typeof item.serviceId === "string" ? item.serviceId : "";
    const name = saved || nameOf(catalog, id);
    if (name) names.push(name);
  }
  return names.join(", ");
}


/** Получено по записи — общей формулой `getPaidAmount` (аванс + доплата,
 *  возврат — ноль). Строка выгрузки несёт только нужные ей колонки. */
export function paidOf(a: AppointmentExportRow): number {
  return getPaidAmount({
    ...a,
    payments: Array.isArray(a.payments) ? a.payments : [],
    payment: a.payment && typeof a.payment === "object" ? a.payment : null,
    prepaid_amount: Number(a.prepaid_amount ?? 0),
    paid_amount: a.paid_amount == null ? null : Number(a.paid_amount),
  } as unknown as Appointment);
}
export function appointmentsToCsv(
  appointments: readonly AppointmentExportRow[],
  refs: { teams: Names; clients: Names; services: Names },
): string {
  const sorted = [...appointments].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.time_start.localeCompare(b.time_start) ||
      a.id.localeCompare(b.id),
  );
  const rows: string[][] = [APPOINTMENT_HEADER.map((h) => csvCell(h))];
  for (const a of sorted) {
    const isWork = a.kind === "work";
    // Заголовок личного события в старых записях лежит в `comment`, а
    // пометки к нему — в `event_notes`: у события теряется иначе одно из двух.
    const note = isWork
      ? a.comment
      : [a.comment, a.event_notes].filter((part) => part.trim() !== "").join(" — ");
    rows.push([
      csvCell(a.date),
      csvCell(hoursMinutes(a.time_start)),
      csvCell(hoursMinutes(a.time_end)),
      csvCell(kindWord(a.kind)),
      csvTextCell(nameOf(refs.teams, a.team_id)),
      csvTextCell(nameOf(refs.clients, a.client_id)),
      csvCell(word(STATUS_LABELS, a.status)),
      csvTextCell(serviceNames(a.services, refs.services)),
      // У личного события денег нет: «0,00» в каждой строке обеда — шум.
      csvAmount(isWork ? a.total_amount : null),
      // «Оплачено» — та же формула, что в записи и долгах: аванс плюс
      // доплата, полный возврат — ноль (проверка системы 03.10: голая
      // колонка paid_amount не знала аванса и писала «0,00» оплаченным).
      csvAmount(isWork ? paidOf(a) : null),
      csvTextCell(a.address),
      csvTextCell(note),
    ]);
  }
  return csvDocument(rows);
}

// ─── Финансы ────────────────────────────────────────────────────────────────

const FINANCE_HEADER = [
  "Дата",
  "Время",
  "Тип",
  "Сумма",
  "Категория",
  "Счёт",
  "Команда",
  "Клиент",
  "Заметка",
  "VAT",
] as const;

/** Сумма со знаком баланса — как `signedAmount` в `local/finance/transaction`
 *  и как в выгрузке бухгалтера: расход и возврат минусом, доход плюсом, ноги
 *  перевода уже лежат со своим знаком. По знаку Excel складывает столбец. */
function signedAmount(type: string, amount: number): number {
  if (type === "refund") return -Math.abs(amount);
  if (type === "expense") return -amount;
  return amount;
}

export function transactionsToCsv(
  transactions: readonly TransactionExportRow[],
  refs: { categories: Names; accounts: Names; teams: Names; clients: Names },
): string {
  // От старых к новым: как лента операций у бухгалтера, а не как на экране.
  const sorted = [...transactions].sort(
    (a, b) =>
      a.occurred_on.localeCompare(b.occurred_on) ||
      (a.occurred_time ?? "").localeCompare(b.occurred_time ?? "") ||
      a.created_at.localeCompare(b.created_at) ||
      a.id.localeCompare(b.id),
  );
  const rows: string[][] = [FINANCE_HEADER.map((h) => csvCell(h))];
  for (const tx of sorted) {
    // «Без VAT» нажато руками — снимку налога не верим, ячейка пустая; знак
    // налога повторяет знак суммы, возврат и расход уносят налог минусом.
    const vat = tx.vat_mode === "none" ? null : tx.vat_amount;
    const vatSigned =
      vat === null || vat === undefined
        ? null
        : tx.type === "expense" || tx.type === "refund"
          ? -Math.abs(vat)
          : vat;
    rows.push([
      csvCell(tx.occurred_on),
      csvCell(hoursMinutes(tx.occurred_time)),
      csvCell(word(TX_TYPE_LABEL, tx.type)),
      csvAmount(signedAmount(tx.type, tx.amount)),
      csvTextCell(nameOf(refs.categories, tx.category_id)),
      csvTextCell(nameOf(refs.accounts, tx.account_id)),
      csvTextCell(nameOf(refs.teams, tx.team_id)),
      csvTextCell(nameOf(refs.clients, tx.client_id)),
      csvTextCell(tx.notes),
      csvAmount(vatSigned),
    ]);
  }
  return csvDocument(rows);
}

/** ОТБОР ОПЕРАЦИЙ ОДНОЙ КОМАНДЫ ДЛЯ `postgrest.or(...)` — тот же, что на экране
 *  «Финансов»: строки команды ПЛЮС строки без команды, чьи деньги лежат на её
 *  счетах. Только по `team_id` выгрузка команды теряла вторые и не сходилась с
 *  экраном (аудит 2026-10-03).
 *
 *  Идентификаторы вклеиваются в строку фильтра, поэтому пропускаются только
 *  безопасные символы: запятая или скобка в id сломала бы фильтр целиком. */
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export function financeTeamFilter(
  teamId: string,
  accounts: readonly Pick<AccountRef, "id" | "brigade_id">[],
): string {
  if (!SAFE_ID.test(teamId)) throw new Error("Не удалось выбрать команду для выгрузки");
  const own = accounts
    .filter((a) => a.brigade_id === teamId && SAFE_ID.test(a.id))
    .map((a) => a.id);
  return own.length > 0
    ? `team_id.eq.${teamId},and(team_id.is.null,account_id.in.(${own.join(",")}))`
    : `team_id.eq.${teamId}`;
}

// ─── Файл ───────────────────────────────────────────────────────────────────

const FILE_STEM: Record<ExportKind, string> = {
  clients: "babun-klienty",
  appointments: "babun-zapisi",
  finances: "babun-finansy",
};

const DIALOG_TITLE: Record<ExportKind, string> = {
  clients: "Клиенты",
  appointments: "Записи",
  finances: "Финансы",
};

/** Локальная дата `ГГГГ-ММ-ДД` — для имени файла. */
export function dateStamp(now: Date): string {
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${mm}-${dd}`;
}

export function exportFilename(kind: ExportKind, stamp: string): string {
  return `${FILE_STEM[kind]}-${stamp}.csv`;
}

export function exportDialogTitle(kind: ExportKind, stamp: string, count: number): string {
  return `${DIALOG_TITLE[kind]} ${stamp} (${count})`;
}
