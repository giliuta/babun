import { useEffect, type ReactNode } from "react";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClientProvider } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import { queryClient } from "@/lib/query-client";
import { SessionProvider } from "@/providers/SessionProvider";
import { startSyncRuntime } from "@/lib/sync-runtime";
import { startSyncBridge } from "@/lib/sync-bridge";
import { useTenantId } from "@/lib/tenant";

/** Mounts the offline-sync replayer subscription for the app lifetime.
 *  Native-only: the replayer drains the SQLite queue via getSql(), which is
 *  un-injected on web (Expo web / Preview) — see bootstrap.ts. On native the
 *  subscription drains the queue whenever connectivity returns. */
function SyncRuntimeMount() {
  useEffect(() => {
    if (Platform.OS === "web") return;
    return startSyncRuntime();
  }, []);
  return null;
}

/** STORY-062 slice 5 — mounts the READ-path freshness bridge (revalidate +
 *  realtime → react-query invalidate). Native-only for the same reason as the
 *  replayer: the SQLite cache the bridge re-reads is un-injected on Expo-web.
 *  Re-subscribes on tenant change (the realtime channels are tenant-scoped),
 *  so it lives BELOW SessionProvider where useTenantId resolves. */
function SyncBridgeMount() {
  const tenantId = useTenantId();
  useEffect(() => {
    if (Platform.OS === "web") return;
    return startSyncBridge(tenantId);
  }, [tenantId]);
  return null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            <SyncRuntimeMount />
            <SyncBridgeMount />
            <StatusBar style="auto" />
            {children}
          </SessionProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
