import type { ReactNode } from "react";
import { useLocalSearchParams } from "expo-router";

import { AccountScopeProvider } from "./account-scope";

// СТРАНИЦА КАБИНЕТА ЗА ЯВНЫЙ АККАУНТ. Блок пригласившего аккаунта
// открывает SMS и историю с `?tenant=<аккаунт>`; страница
// читает и платит за него, а не за аккаунт, открытый на телефоне. Ссылке на
// слово не верят: роль в аккаунте берётся из своих членств
// (`useAccountScope` → `roleInAccount`), чужой идентификатор ничего не
// открывает, а сервер отвечает по своим правилам заголовка.
export function CabinetAccountRoute({ children }: { children: ReactNode }) {
  const { tenant } = useLocalSearchParams<{ tenant?: string }>();
  return <AccountScopeProvider tenantId={tenant || null}>{children}</AccountScopeProvider>;
}

/** Адрес страницы Кабинета за аккаунт `tenantId`. */
export function accountHref(
  path: "/cabinet/sms" | "/cabinet/history",
  tenantId: string,
): string {
  return `${path}?tenant=${encodeURIComponent(tenantId)}`;
}
