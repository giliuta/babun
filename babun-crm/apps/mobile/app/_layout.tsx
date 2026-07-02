import "@/bootstrap"; // MUST be first — polyfills + storage seam + sentry.
import "../global.css"; // NativeWind base styles.

import { useEffect } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { AppProviders } from "@/providers/AppProviders";
import { useSession } from "@/providers/SessionProvider";
import { useOnboardingGate } from "@/lib/tenant";
import { ToastProvider } from "@/components/ui/Toast";

void SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { session, loading } = useSession();
  // Onboarding gate — web parity with apps/web/src/app/dashboard/layout.tsx
  // (STORY-040): fresh tenants (onboarded_at IS NULL) go to the wizard, not
  // the dashboard. Fail-open by design: a transient lookup error ("unknown")
  // must NEVER bounce a configured user onto onboarding.
  const gate = useOnboardingGate();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === "(auth)";
    // The password-recovery deep link creates a real session but must STAY on
    // the reset-password screen to let the user set a new password.
    const onResetPassword = segments[1] === "reset-password";
    const onOnboarding = segments[1] === "onboarding";

    if (!session) {
      // Онбординг живёт внутри (auth), но после «Выйти» (signOutAndWipe из
      // GateErrorCard) оставаться на нём нельзя: гейт вернёт "signed-out" и
      // экран навсегда покажет PendingCard-спиннер. Уводим на /login.
      if (!inAuthGroup || onOnboarding) router.replace("/login");
    } else if (!onResetPassword) {
      switch (gate.status) {
        case "loading":
          // Не знаем ещё, куда вести (свежий пользователь без локального
          // кэша) — держим splash. Состояние ограничено таймаутом гейт-
          // запросов в src/lib/tenant.ts, зависнуть навсегда оно не может.
          return;
        case "needs-onboarding":
        case "no-tenant":
          if (!onOnboarding) router.replace("/onboarding");
          break;
        default:
          // "onboarded" | "unknown" → dashboard. С экрана онбординга уводим
          // только при ПОДТВЕРЖДЁННОМ onboarded — сетевой блип ("unknown")
          // не должен выдёргивать пользователя из середины мастера.
          if (inAuthGroup && (!onOnboarding || gate.status === "onboarded")) {
            router.replace("/");
          }
      }
    }

    void SplashScreen.hideAsync();
  }, [session, loading, gate.status, segments, router]);

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
