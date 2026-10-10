import { Redirect, Stack, useSegments } from "expo-router";
import { useSession } from "@/providers/SessionProvider";
import { useOnboardingGate } from "@/lib/tenant";
import { usePendingInvitationToken } from "@/features/settings/invitations";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { signupFinish } from "@/components/auth/signup-finish";

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
  // ПЕРЕЕЗД РЕПОЗИТОРИЯ СУЗИЛ ТИП МАРШРУТОВ. `useSegments()` теперь выводит
  // кортеж длиной 1 — маршрутов в новой раскладке типизировано меньше, — и
  // обращение к `segments[1]` перестало компилироваться. Читаем как обычный
  // массив строк: проверка та же, а тип больше не спорит с реальностью, где
  // сегментов два («(auth)», «reset-password»).
  const path = segments as readonly string[];
  const onResetPassword = path[1] === "reset-password";
  const onAccountMissing = path[1] === "account-missing";
  const onFinishSignup = path[1] === "finish-signup";

  // ВЫШЕДШИЙ НЕ ЖДЁТ НА ЗАПАСНОМ ЭКРАНЕ (04.10, Pro Max владельца: «застыла и
  // не открывается»). Запасной экран — для вошедшего, чьи данные не открылись;
  // гейт ниже уводит только ВОШЕДШИХ, а без сессии экран показывал загрузку
  // без поля и кнопки — навсегда, пока приложение не убьют.
  if (!session && onAccountMissing) return <Redirect href="/login" />;

  // A signed-in user doesn't belong in the auth stack: send them to the app.
  // Мастера настройки нет (04.10): только аккаунт без данных уходит на
  // запасной экран. "unknown" fails open to the dashboard, mirroring
  // (dashboard)/_layout.
  if (session && !onResetPassword) {
    // Read the Keychain-backed pending token before applying the ordinary
    // dashboard redirect. Otherwise the first signed-in render can
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
    // «ПОЧТИ ГОТОВО» (09.10): первый вход через Apple/Google — придумать
    // пароль; аккаунт почтой с экрана входа — назвать себя.
    if (signupFinish(session.user).needed) {
      if (!onFinishSignup) return <Redirect href="/finish-signup" />;
    } else if (gate.status === "no-tenant") {
      if (!onAccountMissing) return <Redirect href="/account-missing" />;
    } else if (gate.status === "onboarded" || gate.status === "unknown") {
      return <Redirect href="/" />;
    }
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* ВХОД — ПЕРВЫЙ ЭКРАН ГРУППЫ. Переход в группу без адреса открывает
          первый объявленный экран; первым стоял запасной — и вышедший
          попадал на вечную загрузку вместо входа. */}
      <Stack.Screen name="login" />
      {/* Запасной экран аккаунта — гейт: свайп назад на логин не должен
          «сбегать» с него (гейт выше всё равно вернёт). */}
      <Stack.Screen name="account-missing" options={{ gestureEnabled: false }} />
      <Stack.Screen name="finish-signup" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
