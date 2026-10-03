import type { ReactNode } from "react";
import { useLocalSearchParams } from "expo-router";

import { AccountScopeProvider } from "./account-scope";

// СТРАНИЦА КАБИНЕТА ЗА ЯВНЫЙ АККАУНТ (04.10). Блок пригласившего аккаунта
// открывает тариф, оплаты, SMS и реквизиты с `?tenant=<аккаунт>`; страница
// читает и платит за него, а не за аккаунт, открытый на телефоне. Ссылке на
// слово не верят: роль в аккаунте берётся из своих членств
// (`useAccountScope` → `roleInAccount`), чужой идентификатор ничего не
// открывает, а сервер отвечает по своим правилам заголовка.
export function CabinetAccountRoute({ children }: { children: ReactNode }) {
  const { tenant } = useLocalSearchParams<{ tenant?: string }>();
  return <AccountScopeProvider tenantId={tenant || null}>{children}</AccountScopeProvider>;
}

/** Адрес страницы Кабинета за аккаунт `tenantId`. */
export function accountHref(path: "/cabinet/tariff" | "/cabinet/payments" | "/cabinet/sms" | "/cabinet/requisites", tenantId: string): string {
  return `${path}?tenant=${encodeURIComponent(tenantId)}`;
}
