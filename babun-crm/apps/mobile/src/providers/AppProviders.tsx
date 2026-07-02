import { useEffect, type ReactNode } from "react";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClientProvider } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import { queryClient } from "@/lib/query-client";
import { SessionProvider } from "@/providers/SessionProvider";
import { startSyncRuntime } from "@/lib/sync-runtime";

/** Mounts the offline-sync replayer subscription for the app lifetime.
 *  Native-only: the replayer drains the SQLite queue via getSql(), which is
 *  un-injected on web (Expo web / Preview) — see bootstrap.ts. On native the
 *  subscription is a no-op until slice 4 starts enqueuing offline writes;
 *  wiring it here keeps the connectivity → drain lifecycle in place. */
function SyncRuntimeMount() {
  useEffect(() => {
    if (Platform.OS === "web") return;
    return startSyncRuntime();
  }, []);
  return null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            <SyncRuntimeMount />
            <StatusBar style="auto" />
            {children}
          </SessionProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
