import "@/bootstrap"; // MUST be first — polyfills + storage seam + sentry.
import "../global.css"; // NativeWind base styles.

import { useEffect } from "react";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { AppProviders } from "@/providers/AppProviders";
import { useSession } from "@/providers/SessionProvider";
import { ToastProvider } from "@/components/ui/Toast";

void SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { loading } = useSession();
  // Hold the native splash until we know whether a session exists. The actual
  // route guards live in the group layouts — (auth)/_layout & (dashboard)/
  // _layout — so a signed-out user is redirected to /login BEFORE the calendar
  // can paint. No effect-driven redirects here, no flash of the wrong screen.
  useEffect(() => {
    if (!loading) void SplashScreen.hideAsync();
  }, [loading]);

  if (loading) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(dashboard)" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AppProviders>
      <ToastProvider>
        <RootNavigator />
      </ToastProvider>
    </AppProviders>
  );
}
