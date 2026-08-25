import { AppState, Platform } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import {
  MutationCache,
  QueryClient,
  focusManager,
  onlineManager,
} from "@tanstack/react-query";
import { notify } from "./notify";

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
    onError: (_error, _variables, _context, mutation) => {
      if (mutation.options.onError || mutation.meta?.errorHandled) return;
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
      staleTime: 30_000,
      retry: 2,
      // With focusManager on AppState this means: foregrounding the app
      // refetches queries that went stale in the background.
      refetchOnWindowFocus: true,
    },
  },
});
