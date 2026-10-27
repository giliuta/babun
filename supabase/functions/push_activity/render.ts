// Текст пуша о делах команды — на языке телефона получателя.
//
// Функция не может импортировать словари приложения
// (`packages/shared/src/i18n/dict`): edge-функция собирается только из своей
// папки и `_shared`. Фраз здесь восемь, поэтому они лежат таблицей прямо тут;
// язык, которого нет в таблице, читает английский. Даты и суммы пишет `Intl`
// на том же языке.
//
// Длина: заголовок до ~50 знаков, текст до ~110 — дальше локскрин iPhone
// обрезает.

export type PushKind = "new" | "change" | "cancel" | "cancel_link" | "moved" | "payment";

export const PUSH_KINDS: readonly PushKind[] = ["new", "change", "cancel", "cancel_link", "moved", "payment"];

export interface ActivityFacts {
  kind: PushKind;
  /** Получатель — владелец аккаунта: ему «Новая работа», мастеру — «Вам назначена». */
  owner: boolean;
  /** Дата записи «ГГГГ-ММ-ДД» и время «ЧЧ:ММ» — местные, как в календаре. */
  date: string | null;
  time: string | null;
  /** Уже отфильтровано правом «record.client»: нет права — `null`. */
  client: string | null;
  city: string | null;
  team: string | null;
  amount: number | null;
  currency: string;
  /** Сегодня в часовом поясе команды, «ГГГГ-ММ-ДД». */
  today: string;
}

type Phrase =
  | "assigned"
  | "newJob"
  | "moved"
  | "cancelled"
  | "cancelledByLink"
  | "movedAway"
  | "paid"
  | "today"
  | "tomorrow";

const PHRASES: Record<string, Record<Phrase, string>> = {
  ru: {
    assigned: "Вам назначена работа",
    newJob: "Новая работа",
    moved: "Работу перенесли",
    cancelled: "Работу отменили",
    cancelledByLink: "Клиент отменил по ссылке",
    movedAway: "Работу передали другой команде",
    paid: "Оплачено {0}",
    today: "Сегодня",
    tomorrow: "Завтра",
  },
  en: {
    assigned: "New job assigned to you",
    newJob: "New job",
    moved: "Job rescheduled",
    cancelled: "Job cancelled",
    cancelledByLink: "Client cancelled via the link",
    movedAway: "Job moved to another team",
    paid: "Paid {0}",
    today: "Today",
    tomorrow: "Tomorrow",
  },
  uk: {
    assigned: "Вам призначено роботу",
    newJob: "Нова робота",
    moved: "Роботу перенесли",
    cancelled: "Роботу скасували",
    cancelledByLink: "Клієнт скасував за посиланням",
    movedAway: "Роботу передали іншій команді",
    paid: "Оплачено {0}",
    today: "Сьогодні",
    tomorrow: "Завтра",
  },
  bg: {
    assigned: "Възложена ви е работа",
    newJob: "Нова работа",
    moved: "Работата е преместена",
    cancelled: "Работата е отменена",
    cancelledByLink: "Клиентът отмени чрез връзката",
    movedAway: "Работата е прехвърлена на друг екип",
    paid: "Платено {0}",
    today: "Днес",
    tomorrow: "Утре",
  },
  el: {
    assigned: "Σας ανατέθηκε εργασία",
    newJob: "Νέα εργασία",
    moved: "Η εργασία μετατέθηκε",
    cancelled: "Η εργασία ακυρώθηκε",
    cancelledByLink: "Ο πελάτης ακύρωσε μέσω του συνδέσμου",
    movedAway: "Η εργασία μεταφέρθηκε σε άλλη ομάδα",
    paid: "Πληρώθηκε {0}",
    today: "Σήμερα",
    tomorrow: "Αύριο",
  },
  de: {
    assigned: "Ihnen wurde ein Auftrag zugewiesen",
    newJob: "Neuer Auftrag",
    moved: "Auftrag verschoben",
    cancelled: "Auftrag storniert",
    cancelledByLink: "Kunde hat über den Link storniert",
    movedAway: "Auftrag an ein anderes Team übergeben",
    paid: "Bezahlt: {0}",
    today: "Heute",
    tomorrow: "Morgen",
  },
  es: {
    assigned: "Se te ha asignado un trabajo",
    newJob: "Nuevo trabajo",
    moved: "Trabajo reprogramado",
    cancelled: "Trabajo cancelado",
    cancelledByLink: "El cliente canceló por el enlace",
    movedAway: "Trabajo pasado a otro equipo",
    paid: "Pagado {0}",
    today: "Hoy",
    tomorrow: "Mañana",
  },
};

function phrases(locale: string): Record<Phrase, string> {
  return PHRASES[locale] ?? PHRASES.en;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(\d{1,2}):(\d{2})/;

function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** «Сегодня» не пишется — только время; «Завтра, 14:00»; дальше — «5 нояб., 14:00». */
export function whenLabel(facts: Pick<ActivityFacts, "date" | "time" | "today">, locale: string): string | null {
  const p = phrases(locale);
  const m = facts.time ? TIME_RE.exec(facts.time) : null;
  const time = m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
  let day: string | null = null;
  if (facts.date && DATE_RE.test(facts.date)) {
    if (facts.date === facts.today) day = time ? null : p.today;
    else if (facts.date === addDays(facts.today, 1)) day = p.tomorrow;
    else {
      day = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(
        new Date(`${facts.date}T12:00:00Z`),
      );
    }
  }
  const parts = [day, time].filter((x): x is string => Boolean(x));
  return parts.length > 0 ? parts.join(", ") : null;
}

export function moneyLabel(amount: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

const clean = (value: string | null | undefined) => {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text.length > 0 ? text : null;
};

export function renderActivity(facts: ActivityFacts, locale: string): { title: string; body: string } {
  const p = phrases(locale);
  if (facts.kind === "payment") {
    const sum = facts.amount != null ? moneyLabel(Math.abs(facts.amount), facts.currency, locale) : "";
    return {
      title: p.paid.replace("{0}", sum).trim(),
      body: [clean(facts.client), clean(facts.team)].filter(Boolean).join(" · "),
    };
  }
  const title = {
    new: facts.owner ? p.newJob : p.assigned,
    change: p.moved,
    cancel: p.cancelled,
    cancel_link: p.cancelledByLink,
    moved: p.movedAway,
  }[facts.kind];
  // «14:00, Иван Петров, Лимассол». Ничего не известно — хотя бы команда.
  const body = [whenLabel(facts, locale), clean(facts.client), clean(facts.city)].filter(Boolean).join(", ");
  return { title, body: body || clean(facts.team) || "" };
}

// ── Сводки утром и вечером ────────────────────────────────────────────────

export interface DigestFacts {
  slot: "morning" | "evening";
  count: number;
  firstTime: string | null;
  firstCity: string | null;
}

interface DigestWords {
  morning: string;
  evening: string;
  today: string;
  tomorrow: string;
  /** Формы слова «визит» по категориям `Intl.PluralRules`. */
  visit: Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };
  first: string;
}

const DIGEST: Record<string, DigestWords> = {
  ru: {
    morning: "План на сегодня",
    evening: "План на завтра",
    today: "Сегодня",
    tomorrow: "Завтра",
    visit: { one: "визит", few: "визита", many: "визитов", other: "визита" },
    first: "первый в {0}",
  },
  en: {
    morning: "Today's plan",
    evening: "Tomorrow's plan",
    today: "Today",
    tomorrow: "Tomorrow",
    visit: { one: "visit", other: "visits" },
    first: "first at {0}",
  },
  uk: {
    morning: "План на сьогодні",
    evening: "План на завтра",
    today: "Сьогодні",
    tomorrow: "Завтра",
    visit: { one: "візит", few: "візити", many: "візитів", other: "візиту" },
    first: "перший о {0}",
  },
  bg: {
    morning: "План за днес",
    evening: "План за утре",
    today: "Днес",
    tomorrow: "Утре",
    visit: { one: "посещение", other: "посещения" },
    first: "първото в {0}",
  },
  el: {
    morning: "Πρόγραμμα σήμερα",
    evening: "Πρόγραμμα αύριο",
    today: "Σήμερα",
    tomorrow: "Αύριο",
    visit: { one: "επίσκεψη", other: "επισκέψεις" },
    first: "η πρώτη στις {0}",
  },
  de: {
    morning: "Plan für heute",
    evening: "Plan für morgen",
    today: "Heute",
    tomorrow: "Morgen",
    visit: { one: "Besuch", other: "Besuche" },
    first: "der erste um {0}",
  },
  es: {
    morning: "Plan de hoy",
    evening: "Plan de mañana",
    today: "Hoy",
    tomorrow: "Mañana",
    visit: { one: "visita", other: "visitas" },
    first: "la primera a las {0}",
  },
};

/** «Сегодня 3 визита, первый в 9:00, Limassol». */
export function renderDigest(facts: DigestFacts, locale: string): { title: string; body: string } {
  const lang = DIGEST[locale] ? locale : "en";
  const w = DIGEST[lang];
  const form = w.visit[new Intl.PluralRules(lang).select(facts.count)] ?? w.visit.other;
  const m = facts.firstTime ? TIME_RE.exec(facts.firstTime) : null;
  const time = m ? `${Number(m[1])}:${m[2]}` : null;
  const parts = [
    `${facts.slot === "morning" ? w.today : w.tomorrow} ${facts.count} ${form}`,
    time ? w.first.replace("{0}", time) : null,
    clean(facts.firstCity),
  ].filter(Boolean);
  return { title: facts.slot === "morning" ? w.morning : w.evening, body: parts.join(", ") };
}
