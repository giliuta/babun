import "@/bootstrap"; // MUST be first — polyfills + storage seam + sentry.
import "../global.css"; // NativeWind base styles.

import { useEffect } from "react";
import { Platform, View } from "react-native";
import { router, Stack, type ErrorBoundaryProps } from "expo-router";
import Head from "expo-router/head";
import * as SplashScreen from "expo-splash-screen";
import { BootSplash } from "@/features/boot/BootSplash";
import { applyUpdateOnStart } from "@/features/boot/apply-update-on-start";
import { AppProviders } from "@/providers/AppProviders";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { MirrorProvider } from "@/session/mirror-state";
import { MirrorBanner, MirrorInsetShim } from "@/components/blocks/MirrorBanner";
import { useSession } from "@/providers/SessionProvider";
import { ChoiceSheetHost } from "@/components/ui/ChoiceSheet";
import { ToastProvider } from "@/components/ui/Toast";
import { AppUpdateGate } from "@/features/app-update/AppUpdateGate";
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
import { getActiveTenantId } from "@/lib/active-tenant";
import { switchTenant } from "@/session/switch-tenant";

void SplashScreen.preventAutoHideAsync();
// Свежее обновление по воздуху — с первого запуска, пока видна заставка.
applyUpdateOnStart();

/** ПОСЛЕДНЯЯ ДВЕРЬ, ЕСЛИ ЭКРАН УПАЛ. Рабочий день не должен застрять на
 *  белом экране. Expo Router сбрасывает упавший маршрут и зовёт `retry`.
 *
 *  ВИД — ОБЛОЖКА ПРОДУКТА (красивая обложка и большая кнопка «Повторить»
 *  внизу): та же `EmptyState`, что у
 *  «Нет связи с сервером», — значок в мягком круге, спокойные слова по центру,
 *  «Повторить» во всю ширину над нижним краем. Техническую причину (часто
 *  по-английски) экран не печатает: в тестовой сборке её показывает панель
 *  разработчика, в рабочей — она не для глаз владельца. */
export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  return (
    <Screen>
      <EmptyState
        state="error"
        fill
        title="Экран не открылся"
        subtitle="Данные целы. Нажмите «Повторить» — экран откроется заново."
        action={{ label: "Повторить", onPress: () => void retry() }}
      />
    </Screen>
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
      // Пуш с сервера о записи из другого аккаунта человека: календарь
      // ищет запись в активном аккаунте, поэтому сперва переход в её.
      if (target.tenantId && target.tenantId !== getActiveTenantId()) {
        void switchTenant(target.tenantId)
          .then(() => openAppointment({ ...target, tenantId: undefined }))
          .catch(() => {});
        return;
      }
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
    <>
    {/* Заголовок вкладки по умолчанию: без него после ухода со страницы со
        своим заголовком (политика, оценка, адрес) вкладка сохраняла её имя. */}
    {Platform.OS === "web" ? (
      <Head>
        <title>Babun</title>
      </Head>
    ) : null}
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(dashboard)" />
      {/* «Новая запись» — экран создания: сиблинг табов, тап по слоту push-ит
          /book ПОВЕРХ таб-бара. Создание закрывает собой всё намеренно — из
          него выходят «Сохранить» или «назад», а не прыжком в другую вкладку.
          Настройки же (/calendar/*) переехали ВНУТРЬ вкладки «Календарь»
          (app/(dashboard)/(home)), чтобы бар из-под них не исчезал. */}
      {/* Запись выезжает справа поверх того, кто её открыл, и уезжает
          обратно на «назад» — одинаково на iPhone и Android. */}
      <Stack.Screen name="book" options={{ animation: "slide_from_right" }} />
      {/* Общие экраны, открытые ПОВЕРХ позвавшего: карточка клиента и её
          справочники. Экран один на продукт (те же файлы, что во вкладке
          «Клиенты»), здесь у него только второй адрес — чтобы «назад»
          возвращало ровно тому, кто позвал (см. app/(shared)/_layout.tsx). */}
      <Stack.Screen name="(shared)" />
      {/* Финансовые документы открываются поверх табов и сами fail-closed
          проверяют роль владельца в app/invoices/_layout.tsx. */}
      <Stack.Screen name="invoices" />
      {/* Счета и хаб «Документы» — тот же приём: поверх табов, «назад»
          возвращает ровно позвавшему (страница финансов, кабинет, инвойс). */}
      <Stack.Screen name="accounts" />
      <Stack.Screen name="documents" />
      {/* Invitation deep links stay outside auth/dashboard guards so a signed-
          out user can preserve the token, authenticate, and return here. */}
      <Stack.Screen name="invite" options={{ gestureEnabled: false }} />
      {/* «Куда приехать мастеру» (STORY-077): клиент открывает
          babun.app/l/<токен> без входа, поэтому экран живёт вне (auth) и
          (dashboard) — как приглашение. */}
      <Stack.Screen name="l" />
      {/* «Подтвердить / Отменить» запись (STORY-089): клиент открывает
          babun.app/r/<токен> из SMS без входа — там же, где «l». */}
      <Stack.Screen name="r" />
      {/* «Онлайн-запись» календаря: заказчик открывает babun.app/b/<токен>
          без входа — там же, где «l» и «r». */}
      <Stack.Screen name="b" />
      {/* «Оплата прошла» — возврат из Stripe после пополнения SMS из
          приложения (STORY-089): без входа, как «l» и «r». */}
      <Stack.Screen name="pay" />
      {/* Документы и «Помощь»: ссылки из карточек
          App Store и Google Play открываются без входа, как «l», «r» и «pay». */}
      <Stack.Screen name="privacy" />
      <Stack.Screen name="terms" />
      <Stack.Screen name="delete-account" />
      <Stack.Screen name="support" />
    </Stack>
    {/* Заставка поверх первого экрана — до готовности календаря. */}
    <BootSplash hold={!!session} />
    </>
  );
}

export default function RootLayout() {
  return (
    <AppProviders>
      {/* РЕЖИМ «ЕГО ГЛАЗАМИ» — НАД ВСЕМ ПРИЛОЖЕНИЕМ: пока он включён, права и
          роль отвечают за сотрудника, и это должно действовать в любом экране,
          включая границы разделов (`access/mirror/mirror-state.tsx`). */}
      <MirrorProvider>
      <ToastProvider>
        {/* Хост выбора «что сделать»: любой chooseOption() рисуется нижним
            листом, а не системным попапом посередине. */}
        <ChoiceSheetHost>
          {/* ПЛАШКА РЕЖИМА — НАД ВСЕМИ МАРШРУТАМИ, А НЕ ТОЛЬКО НАД ВКЛАДКАМИ.
              Стояла она внутри `(dashboard)`, и экраны-соседи — запись,
              карточка клиента по ссылке, счета, документы — оставались в
              режиме без единого признака и без выхода: владелец не понимал,
              почему приложение перестало сохранять. */}
          <View style={{ flex: 1 }}>
            <MirrorBanner />
            <MirrorInsetShim>
              {/* «Вышло обновление»: устаревшую сборку не пускает
                  дальше, новую версию в магазине — показывает плашкой. */}
              <AppUpdateGate>
                <RootNavigator />
              </AppUpdateGate>
            </MirrorInsetShim>
          </View>
        </ChoiceSheetHost>
      </ToastProvider>
      </MirrorProvider>
    </AppProviders>
  );
}
