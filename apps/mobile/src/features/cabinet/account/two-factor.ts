// ДВУХФАКТОРНЫЙ ВХОД В «ВХОД И БЕЗОПАСНОСТЬ» — то, что считается без сети.

/** Аккаунт, которым входит проверка Apple. Двухфакторного входа у него нет и
 *  быть не может: проверяющему код из чужого телефона взять неоткуда, и
 *  включённый по ошибке фактор закрыл бы приложение для проверки. */
const REVIEW_ACCOUNT = "babun.app+review@gmail.com";

export function twoFactorOffered(email: string | null | undefined): boolean {
  return (email ?? "").trim().toLowerCase() !== REVIEW_ACCOUNT;
}

/** QR из ответа `mfa.enroll` — `data:image/svg+xml;utf-8,<svg…>` — в саму
 *  разметку SVG для `SvgXml`. Закодированную (`%3Csvg…`) раскодирует. */
export function qrSvgOf(dataUri: string | null | undefined): string | null {
  const raw = dataUri ?? "";
  const comma = raw.indexOf(",");
  if (!raw.startsWith("data:image/svg+xml") || comma < 0) return null;
  const body = raw.slice(comma + 1);
  try {
    const svg = body.trimStart().startsWith("<") ? body : decodeURIComponent(body);
    return svg.trimStart().startsWith("<svg") ? svg : null;
  } catch {
    return null;
  }
}

/** Ключ для ручного ввода — четвёрками: «JBSW Y3DP EHPK 3PXP». */
export function groupedSecret(secret: string | null | undefined): string {
  return (secret ?? "").replace(/\s+/g, "").replace(/(.{4})(?=.)/g, "$1 ");
}
