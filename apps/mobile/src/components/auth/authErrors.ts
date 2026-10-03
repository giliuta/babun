// One voice for Supabase auth failures — never leak raw English into the UI.
// A no-signal field owner shouldn't be told their password is wrong.
type SbError = { message?: string; code?: string };

export function mapAuthError(
  e: SbError,
  kind: "signin" | "signup" | "reset" = "signin",
): string {
  const m = (e.message ?? "").toLowerCase();
  const c = (e.code ?? "").toLowerCase();

  if (
    m.includes("network") ||
    m.includes("fetch") ||
    m.includes("timeout") ||
    m.includes("connection")
  )
    return "Нет связи. Проверьте интернет и повторите";

  if (c.includes("rate") || m.includes("rate limit") || m.includes("too many"))
    return "Слишком много попыток, подождите минуту";

  if (c.includes("email_not_confirmed") || m.includes("not confirmed"))
    return "Подтвердите почту — мы отправили ссылку";

  if (kind === "signup") {
    if (
      c.includes("user_already_exists") ||
      m.includes("already registered") ||
      m.includes("already been registered")
    )
      return "Этот email уже зарегистрирован — войдите";
    if (c.includes("weak_password") || m.includes("should be at least") || m.includes("password"))
      return "Пароль слишком простой — минимум 8 символов";
    return "Не удалось создать аккаунт";
  }

  if (kind === "reset") {
    if (c.includes("weak_password") || m.includes("should be at least"))
      return "Пароль слишком простой — минимум 8 символов";
    if (m.includes("same") || m.includes("different from"))
      return "Новый пароль должен отличаться от старого";
    return "Не удалось обновить пароль. Попробуйте ещё раз";
  }

  return "Неверная почта или пароль";
}

/**
 * GoTrue с подтверждением почты НЕ ОШИБАЕТСЯ на уже занятом адресе: чтобы не
 * выдавать, кто зарегистрирован, он отвечает «успехом» без сессии и с пустым
 * `identities` — и письма не шлёт. Экран показывал «Письмо ушло на …», и
 * человек ждал письма, которого не будет (аудит первого входа 03.10).
 */
export function signUpHitExistingAccount(
  data: { user: { identities?: readonly unknown[] | null } | null; session: unknown } | null,
): boolean {
  return !!data?.user && !data.session && Array.isArray(data.user.identities) && data.user.identities.length === 0;
}
