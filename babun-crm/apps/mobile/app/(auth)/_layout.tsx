import { Redirect, Stack, useSegments } from "expo-router";
import { useSession } from "@/providers/SessionProvider";
import { useOnboardingGate } from "@/lib/tenant";
import { usePendingInvitationToken } from "@/features/settings/invitations";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";

function AccountLoading() {
  return (
    <Screen edges={["top", "bottom"]}>
      <EmptyState state="loading" fill title="Открываем аккаунт" />
    </Screen>
  );
}

export default function AuthLayout() {
  const { session } = useSession();
  const gate = useOnboardingGate();
  const pendingInvitation = usePendingInvitationToken();
  const segments = useSegments();
  // The password-recovery deep link creates a real session but must STAY on
  // reset-password so the user can set a new password (see reset-password.tsx).
  const onResetPassword = segments[1] === "reset-password";
  const onOnboarding = segments[1] === "onboarding";

  // A signed-in user doesn't belong in the auth stack: send configured users to
  // the app and unconfigured ones to the wizard. "unknown" fails open to the
  // dashboard, mirroring (dashboard)/_layout.
  if (session && !onResetPassword) {
    // Read the Keychain-backed pending token before applying the ordinary
    // dashboard/onboarding redirect. Otherwise the first signed-in render can
    // discard the deep-link flow and strand an accepted membership inactive.
    if (pendingInvitation.isPending || gate.status === "loading") {
      return <AccountLoading />;
    }
    if (pendingInvitation.data) {
      return (
        <Redirect
          href={{
            pathname: "/invite/[token]",
            params: { token: pendingInvitation.data },
          }}
        />
      );
    }
    if (gate.status === "needs-onboarding" || gate.status === "no-tenant") {
      if (!onOnboarding) return <Redirect href="/onboarding" />;
    } else if (gate.status === "onboarded" || gate.status === "unknown") {
      return <Redirect href="/" />;
    }
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* Онбординг — обязательный гейт: свайп назад на логин не должен
          «сбегать» из мастера (гейт выше всё равно вернёт). */}
      <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
