// ПИСЬМО-ПРИГЛАШЕНИЕ ПАРТНЁРУ — ЧИСТЫЙ ЛИСТ БЕЗ СЕТИ.
//
// Владелец 04.10: партнёра зовут в приложении, и ему уходит письмо с адреса
// Babun. Текст собирается здесь, без Deno- и сетевых импортов, чтобы его
// проверял обычный `bun test`; `index.ts` только забирает данные и отправляет.
//
// Ссылка — https, а не `babun://`: почтовики схему приложения не открывают,
// а на компьютере её открыть некому. babun.app отдаёт веб-сборку на любой
// путь, `/invite/<токен>` ведёт на экран приёма.
//
// Язык письма — язык интерфейса того, кто зовёт (`locale` из приложения):
// языка приглашённого мы ещё не знаем. Вид — как у писем кода (Supabase Auth).

export type InvitationEmailPayload = {
  email: string;
  token: string;
  account: string;
  inviter: string | null;
  teams: string[];
  expires_at: string;
};

export type RenderedEmail = { subject: string; text: string; html: string };

export const EMAIL_LOCALES = ["ru", "en", "bg", "el", "uk", "de", "es"] as const;
export type EmailLocale = (typeof EMAIL_LOCALES)[number];

type Words = {
  intl: string;
  subject: (inviter: string) => string;
  lead: (inviter: string) => string;
  teams: string;
  how: string;
  button: string;
  copy: string;
  until: (date: string) => string;
  ignore: string;
};

const WORDS: Record<EmailLocale, Words> = {
  ru: {
    intl: "ru-RU",
    subject: (who) => `${who} приглашает вас в Babun`,
    lead: (who) => `${who} приглашает вас работать вместе в Babun.`,
    teams: "Команды",
    how: "Нажмите кнопку и войдите или зарегистрируйтесь этой почтой — команды появятся в вашем календаре.",
    button: "Принять приглашение",
    copy: "Если кнопка не открывается, скопируйте ссылку:",
    until: (d) => `Приглашение действует до ${d}.`,
    ignore: "Если вы не ждали этого письма, просто удалите его.",
  },
  en: {
    intl: "en-GB",
    subject: (who) => `${who} invites you to Babun`,
    lead: (who) => `${who} invites you to work together in Babun.`,
    teams: "Teams",
    how: "Tap the button and sign in or sign up with this email — the teams will appear in your calendar.",
    button: "Accept invitation",
    copy: "If the button doesn't open, copy this link:",
    until: (d) => `The invitation is valid until ${d}.`,
    ignore: "If you weren't expecting this email, just delete it.",
  },
  bg: {
    intl: "bg-BG",
    subject: (who) => `${who} ви кани в Babun`,
    lead: (who) => `${who} ви кани да работите заедно в Babun.`,
    teams: "Екипи",
    how: "Натиснете бутона и влезте или се регистрирайте с този имейл — екипите ще се появят в календара ви.",
    button: "Приеми поканата",
    copy: "Ако бутонът не се отваря, копирайте връзката:",
    until: (d) => `Поканата е валидна до ${d}.`,
    ignore: "Ако не сте очаквали това писмо, просто го изтрийте.",
  },
  el: {
    intl: "el-GR",
    subject: (who) => `${who} σας προσκαλεί στο Babun`,
    lead: (who) => `${who} σας προσκαλεί να συνεργαστείτε στο Babun.`,
    teams: "Ομάδες",
    how: "Πατήστε το κουμπί και συνδεθείτε ή εγγραφείτε με αυτό το email — οι ομάδες θα εμφανιστούν στο ημερολόγιό σας.",
    button: "Αποδοχή πρόσκλησης",
    copy: "Αν το κουμπί δεν ανοίγει, αντιγράψτε τον σύνδεσμο:",
    until: (d) => `Η πρόσκληση ισχύει έως ${d}.`,
    ignore: "Αν δεν περιμένατε αυτό το μήνυμα, απλώς διαγράψτε το.",
  },
  uk: {
    intl: "uk-UA",
    subject: (who) => `${who} запрошує вас до Babun`,
    lead: (who) => `${who} запрошує вас працювати разом у Babun.`,
    teams: "Команди",
    how: "Натисніть кнопку й увійдіть або зареєструйтеся з цією поштою — команди з’являться у вашому календарі.",
    button: "Прийняти запрошення",
    copy: "Якщо кнопка не відкривається, скопіюйте посилання:",
    until: (d) => `Запрошення дійсне до ${d}.`,
    ignore: "Якщо ви не чекали цього листа, просто видаліть його.",
  },
  de: {
    intl: "de-DE",
    subject: (who) => `${who} lädt dich zu Babun ein`,
    lead: (who) => `${who} lädt dich ein, in Babun zusammenzuarbeiten.`,
    teams: "Teams",
    how: "Tippe auf den Button und melde dich mit dieser E-Mail an oder registriere dich — die Teams erscheinen in deinem Kalender.",
    button: "Einladung annehmen",
    copy: "Falls sich der Button nicht öffnet, kopiere diesen Link:",
    until: (d) => `Die Einladung ist gültig bis ${d}.`,
    ignore: "Wenn du diese E-Mail nicht erwartet hast, lösche sie einfach.",
  },
  es: {
    intl: "es-ES",
    subject: (who) => `${who} te invita a Babun`,
    lead: (who) => `${who} te invita a trabajar juntos en Babun.`,
    teams: "Equipos",
    how: "Pulsa el botón e inicia sesión o regístrate con este correo: los equipos aparecerán en tu calendario.",
    button: "Aceptar invitación",
    copy: "Si el botón no se abre, copia este enlace:",
    until: (d) => `La invitación es válida hasta el ${d}.`,
    ignore: "Si no esperabas este correo, simplemente elimínalo.",
  },
};

const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;

export function emailLocale(value: unknown): EmailLocale {
  return (EMAIL_LOCALES as readonly string[]).includes(value as string)
    ? (value as EmailLocale)
    : "ru";
}

export function invitationLink(origin: string, token: string): string {
  if (!TOKEN_RE.test(token)) throw new Error("invalid invitation token");
  return `${origin.replace(/\/+$/, "")}/invite/${token}`;
}

/** Строка заголовка письма не может переносить строки. */
function oneLine(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Дата окончания по времени Кипра: аккаунты Babun сейчас там. */
export function expiryDate(iso: string, locale: EmailLocale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(WORDS[locale].intl, {
    day: "numeric",
    month: "long",
    timeZone: "Europe/Nicosia",
  }).format(date);
}

export function renderInvitationEmail(
  payload: InvitationEmailPayload,
  origin: string,
  locale: EmailLocale = "ru",
): RenderedEmail {
  const w = WORDS[locale];
  const link = invitationLink(origin, payload.token);
  const inviter =
    (payload.inviter && oneLine(payload.inviter)) || oneLine(payload.account) || "Babun";
  const teams = payload.teams.map(oneLine).filter(Boolean);
  const until = expiryDate(payload.expires_at, locale);

  const subject = w.subject(inviter);
  const lead = w.lead(inviter);
  const teamsLine = teams.length > 0 ? `${w.teams}: ${teams.join(", ")}` : "";
  const tail = [until ? w.until(until) : "", w.ignore].filter(Boolean).join(" ");

  const text = [lead, teamsLine, "", w.how, "", `${w.button}: ${link}`, "", tail]
    .filter((line, i, all) => !(line === "" && all[i - 1] === ""))
    .join("\n");

  const html = `<!doctype html>
<html lang="${locale}"><body style="margin:0">
<div style="margin:0;padding:32px 16px;background:#f3f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
  <div style="max-width:440px;margin:0 auto;background:#ffffff;border-radius:10px;padding:32px 28px;text-align:center">
    <img src="https://babun.app/icons/icon-192.png" width="64" height="64" alt="Babun" style="display:block;margin:0 auto;border:0;border-radius:16px" />
    <div style="margin-top:10px;font-size:20px;font-weight:700;color:#0f172a;letter-spacing:-0.3px">Babun</div>
    <h1 style="margin:24px 0 8px;font-size:20px;line-height:26px;font-weight:700;color:#0f172a">${escapeHtml(lead)}</h1>
    ${teamsLine ? `<p style="margin:0 0 16px;font-size:15px;line-height:22px;color:#0f172a;font-weight:600">${escapeHtml(teamsLine)}</p>` : ""}
    <p style="margin:0 0 24px;font-size:15px;line-height:22px;color:#475569">${escapeHtml(w.how)}</p>
    <a href="${escapeHtml(link)}" style="display:inline-block;background:#2c5be0;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;border-radius:10px;padding:14px 28px">${escapeHtml(w.button)}</a>
    <p style="margin:24px 0 0;font-size:13px;line-height:19px;color:#94a3b8">${escapeHtml(w.copy)}<br><span style="word-break:break-all">${escapeHtml(link)}</span></p>
    <p style="margin:16px 0 0;font-size:13px;line-height:19px;color:#94a3b8">${escapeHtml(tail)}</p>
  </div>
</div>
</body></html>`;

  return { subject, text, html };
}
