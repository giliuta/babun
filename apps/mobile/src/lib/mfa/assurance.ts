// ДВУХФАКТОРНЫЙ ВХОД: НУЖЕН ЛИ ВТОРОЙ ШАГ.
//
// Пароль (или Google, Apple, ссылка из письма) даёт сессию первого уровня —
// `aal1` в токене. Если у человека есть подтверждённый фактор TOTP
// (приложение-аутентификатор), сессия должна дойти до `aal2` кодом из
// приложения, и до этого в приложение не пускаем.
//
// Считаем по самой сессии, без сети и без замков клиента: уровень — поле
// `aal` в токене, факторы — `user.factors` (их отдаёт сервер при входе и при
// каждом обновлении токена). То же делает `mfa.getAuthenticatorAssuranceLevel`,
// но тот читает сессию через клиент, а здесь она уже в руках — у события входа.

type Level = "aal1" | "aal2";

type SessionLike = {
  access_token?: string | null;
  user?: { factors?: readonly { factor_type?: string; status?: string }[] | null } | null;
} | null | undefined;

/** Уровень из токена: `aal` полезной нагрузки JWT; непонятное — null. */
export function tokenLevel(accessToken: string | null | undefined): Level | null {
  const payload = accessToken?.split(".")[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const aal = (JSON.parse(atob(padded)) as { aal?: unknown }).aal;
    return aal === "aal1" || aal === "aal2" ? aal : null;
  } catch {
    return null;
  }
}

/** Подтверждённый фактор TOTP у человека — двухфакторный вход включён. */
export function hasVerifiedTotp(session: SessionLike): boolean {
  return (session?.user?.factors ?? []).some(
    (factor) => factor.factor_type === "totp" && factor.status === "verified",
  );
}

/** Вошёл первым шагом, а двухфакторный вход включён — нужен код из
 *  приложения. Токен без понятного уровня второго шага не требует: старый
 *  сервер или сессия без `aal` не должны запирать человека снаружи. */
export function needsSecondStep(session: SessionLike): boolean {
  if (!session) return false;
  return tokenLevel(session.access_token) === "aal1" && hasVerifiedTotp(session);
}
