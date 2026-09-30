// ПИСЬМО-ПРИГЛАШЕНИЕ — ЧИСТЫЙ ЛИСТ БЕЗ СЕТИ.
//
// Решение владельца 14.09: приглашение уходит письмом с адреса Babun. Текст
// собирается здесь, без Deno- и сетевых импортов, чтобы его проверял обычный
// `bun test`, а функция `index.ts` только забирала данные и отправляла.
//
// Ссылка в письме — https, а не `babun://`: почтовики схему приложения обычно
// не открывают. babun.app отдаёт веб-сборку на любой путь, `/invite/<токен>`
// ведёт на тот же экран приёма. Открыть сразу приложение умеют только
// universal links — это решение сборки, не этого листа.

export type InvitationRole = "dispatcher" | "master";

export type InvitationEmailPayload = {
  email: string;
  token: string;
  company: string;
  inviter: string | null;
  role: InvitationRole;
  calendar: string | null;
  expires_at: string;
};

export type RenderedEmail = { subject: string; text: string; html: string };

/** Имена ролей — те же, что в «Доступ в CRM» (`ROLE_LABELS`): одна роль —
 *  одно имя на экранах и в письмах. */
export const ROLE_LABELS_RU: Record<InvitationRole, string> = {
  dispatcher: "Диспетчер",
  master: "Бригадир / мастер",
};

const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;

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

/** Дата окончания по времени Кипра: компании Babun сейчас там. */
export function expiryDateRu(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/Nicosia",
  }).format(date);
}

export function renderInvitationEmail(
  payload: InvitationEmailPayload,
  origin: string,
): RenderedEmail {
  const link = invitationLink(origin, payload.token);
  const company = oneLine(payload.company) || "Babun";
  const inviter = payload.inviter ? oneLine(payload.inviter) : "";
  const calendar = payload.calendar ? oneLine(payload.calendar) : "";
  const role = ROLE_LABELS_RU[payload.role];
  if (!role) throw new Error("unsupported invitation role");
  const until = expiryDateRu(payload.expires_at);

  const subject = `Вас пригласили в «${company}»`;
  const lead = inviter
    ? `${inviter} приглашает вас в «${company}» в Babun.`
    : `Вас приглашают в «${company}» в Babun.`;
  const details = [`Роль: ${role}.`, calendar ? `Календарь: ${calendar}.` : ""].filter(Boolean);
  const tail = until
    ? `Приглашение действует до ${until}. Если вы не ждали этого письма, просто не отвечайте на него.`
    : "Если вы не ждали этого письма, просто не отвечайте на него.";

  const text = [
    "Здравствуйте!",
    "",
    lead,
    ...details,
    "",
    `Принять приглашение: ${link}`,
    "",
    tail,
  ].join("\n");

  const html = `<!doctype html>
<html lang="ru"><body style="margin:0;padding:24px 16px;background:#f4f5f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#15171c">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px">
<tr><td style="padding:28px 24px 8px;font-size:20px;font-weight:600">${escapeHtml(subject)}</td></tr>
<tr><td style="padding:8px 24px;font-size:16px;line-height:1.5">${escapeHtml(lead)}</td></tr>
<tr><td style="padding:0 24px 8px;font-size:15px;line-height:1.5;color:#474b55">${details.map(escapeHtml).join("<br>")}</td></tr>
<tr><td style="padding:16px 24px"><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 20px;background:#2f5bea;color:#ffffff;text-decoration:none;border-radius:10px;font-size:16px;font-weight:600">Принять приглашение</a></td></tr>
<tr><td style="padding:0 24px 8px;font-size:13px;line-height:1.5;color:#6b6f79">Если кнопка не открывается, скопируйте ссылку:<br><span style="word-break:break-all">${escapeHtml(link)}</span></td></tr>
<tr><td style="padding:8px 24px 28px;font-size:13px;line-height:1.5;color:#6b6f79">${escapeHtml(tail)}</td></tr>
</table>
</body></html>`;

  return { subject, text, html };
}
