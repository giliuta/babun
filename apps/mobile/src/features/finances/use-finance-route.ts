import { useCallback, useEffect, useRef, useState } from "react";
import type { HomeView } from "./FinanceOverview";
import { NO_TEAM } from "./accounts-sections";
import {
  financeRoute,
  routeParam,
  type FinanceRouteParams,
} from "./finance-route";

// РАЗРЕЗ, КОМАНДА И ВЫБРАННЫЙ СЧЁТ «ФИНАНСОВ» — ИЗ АДРЕСА И ОБРАТНО.
//
// Жили в экране вкладки тремя `useState` и читались ОДИН раз, при создании.
// Вкладка же чаще смонтирована, чем нет: ссылка «Добавить счёт этой команде»
// из календаря или инвойса приходила в открытые «Финансы» и не переключала ни
// разрез, ни команду. Теперь адрес применяется и при создании (ленивый
// инициализатор — разрез стоит уже в первом кадре, без вспышки общей ленты), и
// когда он МЕНЯЕТСЯ на смонтированной вкладке. Тот же адрес второй раз не
// применяется: иначе любой рендер возвращал бы человека туда, откуда он уже
// ушёл тапом.

interface Account {
  id: string;
  brigade_id: string | null;
}

export function useFinanceRoute(
  params: FinanceRouteParams,
  /** Счета компании: адрес со счётом, но без команды, открывает команду
   *  самого счёта. `undefined` — ещё не доехали. */
  accounts: readonly Account[] | undefined,
) {
  const [initial] = useState(() => financeRoute(params));
  const [view, setView] = useState<HomeView>(initial?.view ?? "all");
  const [scope, setScope] = useState<string | null>(initial?.team ?? null);
  // ВЫБРАННЫЙ СЧЁТ ПЕРЕЖИВАЕТ ПОЕЗДКУ В ЗАПИСЬ так же, как разрез: открыл
  // «Наличные», из их ленты — запись, закрыл её и снова видишь ленту
  // «Наличных», а не всех счетов (2026-09-15).
  const [accountId, setAccountId] = useState<string | null>(
    initial?.account ?? null,
  );
  // ДОРОГА НАЗАД ИЗ ЗАПИСИ КОМАНДУ НЕ НЕСЁТ — её называет сам счёт. Без этого
  // пересозданная вкладка вставала на первую команду, и «Карта» второй
  // команды, выбранная до поездки в запись, пропадала с плиток.
  const teamOfAccount = useRef(
    initial && !initial.team ? initial.account : null,
  );

  const viewParam = routeParam(params.view);
  const teamParam = routeParam(params.team);
  const accountParam = routeParam(params.account);
  const applied = useRef(`${viewParam}|${teamParam}|${accountParam}`);
  useEffect(() => {
    const key = `${viewParam}|${teamParam}|${accountParam}`;
    if (applied.current === key) return;
    applied.current = key;
    const next = financeRoute({
      view: viewParam,
      team: teamParam,
      account: accountParam,
    });
    // Адрес без разреза (`/finances` после снятия фильтра клиента) ничего не
    // переставляет: выбранное тапом остаётся на месте.
    if (!next) return;
    setView(next.view);
    setAccountId(next.account);
    if (next.team) setScope(next.team);
    teamOfAccount.current = next.team ? null : next.account;
  }, [viewParam, teamParam, accountParam]);

  useEffect(() => {
    const id = teamOfAccount.current;
    if (!id || !accounts) return;
    teamOfAccount.current = null;
    const owner = accounts.find((account) => account.id === id);
    if (owner) setScope(owner.brigade_id ?? NO_TEAM);
    // Параметры адреса — в зависимостях нарочно: эффект выше только что мог
    // назвать новый счёт, и команду ему ищем в том же кадре.
  }, [accounts, viewParam, teamParam, accountParam]);

  // Уходя из «Счетов», выбор снимаем: разрез открывается заново, как любой
  // другой.
  useEffect(() => {
    if (view !== "accounts") setAccountId(null);
  }, [view]);

  // ВЫБОР СЧЁТА СНИМАЕТСЯ СМЕНОЙ КОМАНДЫ. Счёт принадлежит одной команде: на
  // чужой команде его плитки нет, а выбор, переживший переключение, всплывал
  // при возврате на первую — человек его уже не видел и не ждал. Снимается
  // здесь, в ответе на ТАП по чипу, а не эффектом на `scope`: скоуп меняет и
  // сам экран (первая живая команда при загрузке, команда счёта из адреса), и
  // эффект стёр бы счёт, восстановленный из адреса.
  const changeScope = useCallback(
    (next: string | null) => {
      if (next === scope) return;
      teamOfAccount.current = null;
      setScope(next);
      setAccountId(null);
    },
    [scope],
  );

  return {
    view,
    setView,
    scope,
    setScope,
    accountId,
    setAccountId,
    changeScope,
  };
}
