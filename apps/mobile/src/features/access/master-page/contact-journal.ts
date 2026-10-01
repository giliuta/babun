// ЖУРНАЛ ОТКРЫТИЙ НОМЕРОВ НА СТРАНИЦЕ СОТРУДНИКА (защита базы 30.09).
//
// Каждый тап сотрудника по номеру клиента сервер записывает
// (`member_client_contacts` → `client_contact_views`), а за всплеск —
// больше 15 номеров за час — ставит тревогу (`client_contact_alerts`).
// Читает это только владелец. Здесь — чистые правила показа: сколько номеров
// открыто за сутки из лимита, последние открытия словами и тревоги.

/** Лимит номеров в сутки — тот же, что у сервера (`member_client_contacts`). */
export const DAILY_CONTACTS_LIMIT = 30;

export type ContactOutcome = "open" | "day" | "right" | "limit";

export interface ContactView {
  client_id: string;
  outcome: ContactOutcome;
  counted: boolean;
  opened_at: string;
}

export interface ContactAlert {
  kind: "spike" | "limit";
  clients_count: number;
  created_at: string;
}

/** Сколько номеров открыто за последние сутки — как считает лимит сервера. */
export function countedLastDay(views: readonly ContactView[], now: Date): number {
  const since = now.getTime() - 24 * 3600_000;
  return views.filter((view) => view.counted && Date.parse(view.opened_at) > since).length;
}

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

const two = (n: number) => String(n).padStart(2, "0");

/** «сегодня 12:40», «вчера 09:10», «30 сен 14:02» — по часам телефона. */
export function whenWords(iso: string, now: Date): string {
  const at = new Date(iso);
  const time = `${two(at.getHours())}:${two(at.getMinutes())}`;
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(now) - day(at)) / 86_400_000);
  if (diff === 0) return `сегодня ${time}`;
  if (diff === 1) return `вчера ${time}`;
  return `${at.getDate()} ${MONTHS[at.getMonth()]} ${time}`;
}

/** Что было с попыткой — словом строки. Открытый номер — просто время. */
export function outcomeWord(outcome: ContactOutcome): string | null {
  switch (outcome) {
    case "open":
      return null;
    case "day":
      return "не в день записи";
    case "limit":
      return "сверх лимита";
    case "right":
      return "нет права";
  }
}

/** Тревога словами: «16 номеров за час», «лимит 30 в сутки». */
export function alertWords(alert: ContactAlert): string {
  if (alert.kind === "limit") return `Упёрся в лимит ${DAILY_CONTACTS_LIMIT} в сутки`;
  const n = alert.clients_count;
  const word = n % 10 === 1 && n % 100 !== 11 ? "номер" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "номера" : "номеров";
  return `${n} ${word} за час`;
}
