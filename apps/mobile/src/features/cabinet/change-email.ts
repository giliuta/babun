import { mapAuthError } from "@/components/auth/authErrors";

/** Отказ смены почты словами: занятый адрес — свой случай, остальное — общий
 *  словарь входа. */
export function changeEmailRefusal(e: { message?: string; code?: string }): string {
  const m = (e.message ?? "").toLowerCase();
  const c = (e.code ?? "").toLowerCase();
  if (c.includes("email_exists") || m.includes("already been registered") || m.includes("already registered"))
    return "Эта почта уже занята другим аккаунтом";
  if (c.includes("same_email") || m.includes("same"))
    return "Это и есть текущая почта";
  return mapAuthError(e, "send");
}
