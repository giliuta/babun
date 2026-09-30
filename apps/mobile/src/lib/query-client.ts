import { AppState, Platform } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import {
  MutationCache,
  QueryClient,
  focusManager,
  onlineManager,
} from "@tanstack/react-query";
import { isWritesBlockedError } from "@babun/shared/sync/write-guard";
import { notify } from "./notify";
import { getActiveTenantId } from "./active-tenant";
import {
  deferredTenantId,
  knownTenantIds,
  refetchOnMountPolicy,
  staleTimeFor,
  type FreshnessContext,
} from "./switch-revalidate-plan";

/** Кто сейчас активен и кого дообновляет очередь — читается на каждое решение
 *  о свежести: оба значения меняются переходом, а не рендером. */
function freshnessContext(): FreshnessContext {
  return {
    activeTenantId: getActiveTenantId(),
    deferredTenantId: deferredTenantId(),
    knownTenantIds: knownTenantIds(),
  };
}

// Client-side data layer (replaces Next.js RSC server loads). Sits on top of
// the @babun/shared repositories; Phase 2 wires offline cache + sync under it.

// RN has no window online/visibility events, so TanStack's defaults never
// fire: without these listeners the client always believes it's online
// (queries burn their retries into `error` instead of pausing, and
// refetchOnReconnect never triggers) and never regains focus. Wire online to
// NetInfo and focus to AppState per the TanStack RN guide. Web (Expo web /
// Preview) keeps the built-in window listeners.
if (Platform.OS !== "web") {
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => {
      // `isConnected: null` = unknown — treat as online, never false-pause.
      setOnline(state.isConnected !== false);
    }),
  );
  AppState.addEventListener("change", (status) => {
    focusManager.setFocused(status === "active");
  });
}

export const queryClient = new QueryClient({
  // Global safety net: a failed mutation must never be silent. Skipped when
  // the error is already handled elsewhere:
  //   * hook-level onError (visible on mutation.options);
  //   * meta.errorHandled — set by useMutation hooks whose EVERY call site
  //     alerts itself (mutate(..., { onError }) or try/catch around
  //     mutateAsync). Those callbacks live on the observer's private
  //     mutateOptions and are invisible here, so without the meta flag the
  //     user would get TWO stacked alerts: this generic one plus the
  //     screen's specific one.
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (mutation.options.onError || mutation.meta?.errorHandled) return;
      // ОТБИТАЯ ЗАПИСЬ — НЕ ПОЛОМКА СВЯЗИ. В режиме «его глазами» приложение
      // не пишет намеренно, и «проверьте соединение» отправило бы человека
      // чинить исправную сеть.
      if (isWritesBlockedError(error)) {
        // Формулировка ОДНА и живёт в самой ошибке: экраны со своим разбором
        // печатают `error.message`, и две разные фразы про одно и то же
        // читались бы как две разные беды.
        notify("Это просмотр", (error as Error).message);
        return;
      }
      // Через notify, а не Alert.alert: на вебе последний — пустая
      // функция, и эта сетка ловила бы ошибки в полной тишине.
      notify(
        "Не удалось сохранить",
        "Проверьте соединение и попробуйте ещё раз.",
      );
    },
  }),
  defaultOptions: {
    queries: {
      // СВЕЖЕСТЬ РЕШАЕТ ВОЗРАСТ ДАННЫХ И ТО, ЧЬЯ ЭТО КОМПАНИЯ.
      //
      // Ключ компании, где человек работает, свеж минуту; ключ компании, куда
      // он только что перешёл, — пока её тихо дообновляет очередь, — и ключи
      // других его компаний свежи десять минут; ключ без компании — прежние
      // 30 с. Функцией, потому что календарь переход не размонтирует: у его
      // запросов меняется ключ, а на смене ключа react-query спрашивает только
      // `staleTime`. Правила и тесты — `switch-revalidate-plan.ts`.
      staleTime: (query) => staleTimeFor(query.queryKey, freshnessContext()),
      // Для экранов со своим коротким `staleTime`: пока компанию дообновляет
      // очередь, монтирование не уходит в сеть за тем, что она перечитает.
      refetchOnMount: (query) =>
        refetchOnMountPolicy(
          query.state,
          query.queryKey,
          freshnessContext(),
          Date.now(),
        ),
      // ТЁПЛЫЙ КЭШ ЖИВЁТ СУТКИ, А НЕ ПЯТЬ МИНУТ.
      //
      // Переход между компаниями бережёт запросы покидаемой компании, чтобы
      // возврат был мгновенным. Но `gcTime` по умолчанию — пять минут: запрос
      // без наблюдателя (а у покинутой компании их нет) уходит в мусор ровно
      // через столько. То есть «второй переход тёплый» было правдой только
      // внутри пятиминутного окна — дольше отсидел в другой компании, и
      // возврат снова холодный. Нашла панель проектирования 2026-09-13.
      //
      // Сутки — потому что смена суток и так перерисовывает календарь, а
      // память двух компаний владельца это единицы мегабайт.
      gcTime: 24 * 60 * 60 * 1000,
      retry: 2,
      // With focusManager on AppState this means: foregrounding the app
      // refetches queries that went stale in the background.
      refetchOnWindowFocus: true,
    },
  },
});
