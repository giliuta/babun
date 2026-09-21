// «ЖДЁТ ОТВЕТА» — СКОЛЬКО ИМЕННО ЖДЁТ.
//
// Приглашение живёт семь дней и молчало об этом: в списке стояло «Ждёт
// ответа» и в первый день, и в седьмой. Владелец звал человека, тот не
// входил, и обоим казалось, что всё идёт своим ходом — пока ссылка не
// протухала. Срок сервер отдаёт с самого начала (`invitations.expires_at`),
// показать его стоило сразу.
//
// Считаем ДНЯМИ, а не часами: точность здесь не нужна, а «осталось 14 часов»
// заставляет считать в уме. Последний день называется словом — в него ещё
// можно успеть, и это единственное, что владельцу надо решить.

export type InvitationWait =
  | { kind: "days"; days: number; text: string }
  | { kind: "last-day"; text: string }
  | { kind: "expired"; text: string };

const DAY_MS = 24 * 60 * 60 * 1000;

export function invitationWait(expiresAt: string, now: Date): InvitationWait {
  const end = Date.parse(expiresAt);
  // Дата нечитаемая — молчим, а не пугаем «истёк»: мы не знаем.
  if (Number.isNaN(end)) return { kind: "days", days: 0, text: "" };

  const left = end - now.getTime();
  if (left <= 0) return { kind: "expired", text: "срок истёк" };

  const days = Math.floor(left / DAY_MS);
  if (days === 0) return { kind: "last-day", text: "сегодня последний день" };
  return { kind: "days", days, text: `осталось ${dayWord(days)}` };
}

/** «1 день», «2 дня», «5 дней» — русский счёт без библиотек. */
function dayWord(days: number): string {
  const tens = days % 100;
  const ones = days % 10;
  if (tens >= 11 && tens <= 14) return `${days} дней`;
  if (ones === 1) return `${days} день`;
  if (ones >= 2 && ones <= 4) return `${days} дня`;
  return `${days} дней`;
}

/** Подпись строки: «ждёт ответа · осталось 3 дня». Срок неизвестен — прежнее
 *  слово без хвоста. */
export function waitSubtitle(expiresAt: string | null | undefined, now: Date): string {
  const base = "ждёт ответа";
  if (!expiresAt) return base;
  const wait = invitationWait(expiresAt, now);
  return wait.text ? `${base} · ${wait.text}` : base;
}
