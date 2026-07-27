import "@/bootstrap"; // MUST be first — polyfills + storage seam + sentry.
import "../global.css"; // NativeWind base styles.

import { useEffect } from "react";
import { Pressable, Text, View } from "react-native";
import { router, Stack, type ErrorBoundaryProps } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { AppProviders } from "@/providers/AppProviders";
import { useSession } from "@/providers/SessionProvider";
import { ChoiceSheetHost } from "@/components/ui/ChoiceSheet";
import { ToastProvider } from "@/components/ui/Toast";
import {
  consumeLastAppointmentNotificationTarget,
  subscribeToAppointmentNotificationResponses,
  type AppointmentNotificationTarget,
} from "@/features/calendar/reminders";
import {
  consumeLastClientNotificationTarget,
  subscribeToClientNotificationResponses,
  type ClientNotificationTarget,
} from "@/features/clients/reminders";
import { reconcileBabunNotifications } from "@/lib/notifications";

void SplashScreen.preventAutoHideAsync();

/** Last-resort native recovery surface. A render error must not strand an
 * operator on a blank white screen in the middle of a working day. Expo
 * Router calls `retry` after resetting the failed route boundary; the fixed
 * palette deliberately stays light even when iOS itself is in dark mode. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const message =
    __DEV__ && error instanceof Error && error.message.trim()
      ? error.message.trim()
      : "Данные не потеряны. Повторите открытие экрана.";

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#F7F8FC",
        paddingHorizontal: 28,
      }}
    >
      <StatusBar style="dark" />
      <Text
        accessibilityRole="header"
        style={{
          color: "#111827",
          fontSize: 22,
          fontWeight: "700",
          textAlign: "center",
        }}
      >
        Экран временно не открылся
      </Text>
      <Text
        selectable
        style={{
          color: "#667085",
          fontSize: 15,
          lineHeight: 21,
          marginTop: 10,
          textAlign: "center",
        }}
      >
        {message}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Повторить открытие экрана"
        onPress={retry}
        style={({ pressed }) => ({
          alignItems: "center",
          backgroundColor: "#176BFF",
          borderRadius: 14,
          justifyContent: "center",
          marginTop: 22,
          minHeight: 48,
          opacity: pressed ? 0.82 : 1,
          paddingHorizontal: 24,
        })}
      >
        <Text style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "700" }}>
          Повторить
        </Text>
      </Pressable>
    </View>
  );
}

function RootNavigator() {
  const { loading, session } = useSession();
  // Hold the native splash until we know whether a session exists. The actual
  // route guards live in the group layouts — (auth)/_layout & DashboardGate,
  // shared by (dashboard) and calendar — so a signed-out user is redirected to
  // /login BEFORE the calendar can paint. No effect-driven redirects here, no
  // flash of the wrong screen.
  useEffect(() => {
    if (!loading) void SplashScreen.hideAsync();
  }, [loading]);

  useEffect(() => {
    if (!session) return;
    let active = true;
    // A native rebuild/reinstall can lose iOS pending requests while MMKV
    // still contains the user's desired reminders. Restore them silently;
    // only an explicit reminder action is allowed to open the permission UI.
    void reconcileBabunNotifications().catch(() => {});
    const openAppointment = (target: AppointmentNotificationTarget) => {
      // Do not route private calendar data before authentication. The
      // dashboard then resolves the id through its role-scoped query and
      // shows a safe "not available" state for foreign/deleted records.
      if (!session || !active) return;
      router.push({
        pathname: "/",
        params: {
          appointmentId: target.appointmentId,
          date: target.date,
          ...(target.teamId ? { teamId: target.teamId } : {}),
        },
      });
    };
    const openClient = (target: ClientNotificationTarget) => {
      if (!session || !active) return;
      router.push({
        pathname: "/(dashboard)/clients/[id]",
        params: { id: target.clientId },
      });
    };
    const unsubscribeAppointment =
      subscribeToAppointmentNotificationResponses(openAppointment);
    const unsubscribeClient =
      subscribeToClientNotificationResponses(openClient);
    void (async () => {
      const appointmentTarget =
        await consumeLastAppointmentNotificationTarget();
      if (appointmentTarget) {
        openAppointment(appointmentTarget);
        return;
      }
      const clientTarget = await consumeLastClientNotificationTarget();
      if (clientTarget) openClient(clientTarget);
    })();
    return () => {
      active = false;
      unsubscribeAppointment();
      unsubscribeClient();
    };
  }, [session]);

  if (loading) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(dashboard)" />
      {/* Настройки календаря — сиблинг табов, а не экран внутри вкладки
          «Кабинет»: шестерёнка живёт на вкладке «Календарь», а push в стек
          чужого таба переключал бы таб-бар под пальцем и двоил «назад».
          Здесь стек открывается ПОВЕРХ табов и всегда возвращает позвавшему. */}
      <Stack.Screen name="calendar" />
      {/* «Новая запись» — экран создания заявки/события. Тот же приём
          сиблинга табов: тап по слоту push-ит /book поверх таб-бара. */}
      <Stack.Screen name="book" />
      {/* Финансовые документы открываются поверх табов и сами fail-closed
          проверяют роль владельца в app/invoices/_layout.tsx. */}
      <Stack.Screen name="invoices" />
      {/* Invitation deep links stay outside auth/dashboard guards so a signed-
          out user can preserve the token, authenticate, and return here. */}
      <Stack.Screen name="invite" options={{ gestureEnabled: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AppProviders>
      <ToastProvider>
        {/* Хост выбора «что сделать»: любой chooseOption() рисуется нижним
            листом, а не системным попапом посередине. */}
        <ChoiceSheetHost>
          <RootNavigator />
        </ChoiceSheetHost>
      </ToastProvider>
    </AppProviders>
  );
}
