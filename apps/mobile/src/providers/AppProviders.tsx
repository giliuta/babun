import { useEffect, type ReactNode } from "react";
import { AppState, Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClientProvider } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import { queryClient } from "@/lib/query-client";
import { SessionProvider, useSession } from "@/providers/SessionProvider";
import { startSyncRuntime } from "@/lib/sync-runtime";
import { startSyncBridge } from "@/lib/sync-bridge";
import { useTenantId } from "@/lib/tenant";
import {
  FIRST_WARM_DELAY_MS,
  REWARM_EVERY_MS,
  warmOtherCompanies,
} from "@/lib/tenant-prefetch";
import { useCurrentRole } from "@/features/settings/tenant";

/** Mounts the offline-sync replayer subscription for the app lifetime.
 *  Native-only: the replayer drains the SQLite queue via getSql(), which is
 *  un-injected on web (Expo web / Preview) — see bootstrap.ts. On native the
 *  subscription drains the queue whenever connectivity returns. */
function SyncRuntimeMount() {
  const tenantId = useTenantId();
  const role = useCurrentRole().data;
  useEffect(() => {
    if (
      Platform.OS === "web" ||
      !tenantId ||
      (role !== "owner" && role !== "dispatcher")
    ) {
      return;
    }
    return startSyncRuntime(tenantId);
  }, [role, tenantId]);
  return null;
}

/** STORY-062 slice 5 — mounts the READ-path freshness bridge (revalidate +
 *  realtime → react-query invalidate). Native-only for the same reason as the
 *  replayer: the SQLite cache the bridge re-reads is un-injected on Expo-web.
 *  Re-subscribes on tenant change (the realtime channels are tenant-scoped),
 *  so it lives BELOW SessionProvider where useTenantId resolves. */
function SyncBridgeMount() {
  const tenantId = useTenantId();
  const role = useCurrentRole().data;
  useEffect(() => {
    if (
      Platform.OS === "web" ||
      (role !== "owner" && role !== "dispatcher")
    ) {
      return;
    }
    return startSyncBridge(tenantId);
  }, [role, tenantId]);
  return null;
}

/** Грелка других компаний (`lib/tenant-prefetch.ts`). Заводится после входа
 *  и после каждого перехода — с отступом, чтобы первый кадр активной
 *  компании ушёл в сеть первым, — и повторяется по таймеру, пока приложение
 *  на переднем плане. Переход между компаниями находит их данные в памяти. */
function WarmCompaniesMount() {
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const tenantId = useTenantId();
  useEffect(() => {
    if (!userId || !tenantId) return;
    const first = setTimeout(() => void warmOtherCompanies(), FIRST_WARM_DELAY_MS);
    const again = setInterval(() => {
      if (AppState.currentState === "active") void warmOtherCompanies();
    }, REWARM_EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(again);
    };
  }, [tenantId, userId]);
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
            <WarmCompaniesMount />
            <StatusBar style="dark" />
            {children}
          </SessionProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
