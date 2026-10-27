import { Platform } from "react-native";
import Constants from "expo-constants";
import { uiLocale } from "@babun/shared/i18n/locale";
import { getStorage } from "@babun/shared/storage";
import { getNotificationsModule } from "@/lib/notifications";
import { supabase } from "@/lib/supabase";

// ПУШ О ДЕЛАХ КОМАНДЫ — ЭТОТ ТЕЛЕФОН В СПИСКЕ ПОЛУЧАТЕЛЕЙ.
//
// Сервер шлёт пуш по журналу изменений (`push_activity`), а адрес телефона —
// Expo push token — лежит в `push_devices`. Телефон кладёт его туда сам при
// каждом входе и запуске (`register_push_device` заодно говорит, на каком
// языке писать) и забирает перед выходом из аккаунта: иначе после «Выйти»
// клиенты прежнего человека продолжали бы светиться на локскрине.
//
// `live` — сервер действительно шлёт пуши. Пока он выключен (у Expo нет
// ключей Apple и Google), телефон владельца сам опрашивает журнал, когда
// приложение открыто (`TeamActivityNotifier`); включился — опрос молчит,
// иначе одна новость пришла бы дважды.

const TOKEN_KEY = "babun:push.token";
const LIVE_KEY = "babun:push.live";

/** Сервер шлёт пуши на этот телефон — опрашивать журнал самому не нужно. */
export function serverPushLive(): boolean {
  try {
    return getStorage().get<boolean>(LIVE_KEY) === true;
  } catch {
    return false;
  }
}

function storedToken(): string | null {
  try {
    return getStorage().getRaw(TOKEN_KEY);
  } catch {
    return null;
  }
}

function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

/** Канал Android для пушей: важность «высокая» — баннер сверху, как у SMS.
 *  Без своего канала Expo кладёт пуш в «Прочее», и Android показывает его
 *  только в шторке. */
async function ensureAndroidChannel(): Promise<void> {
  const Notifications = getNotificationsModule();
  if (Platform.OS !== "android" || !Notifications) return;
  await Notifications.setNotificationChannelAsync("default", {
    name: "Babun",
    importance: Notifications.AndroidImportance.HIGH,
  }).catch(() => {});
}

/** Записать этот телефон в получатели. Без разрешения на уведомления
 *  ничего не делает — спросить может только `askOnce` (при входе и строкой
 *  разрешения на «Уведомлениях»). */
export async function registerThisDevice(options: { askOnce?: boolean } = {}): Promise<"registered" | "denied" | "unavailable"> {
  const Notifications = getNotificationsModule();
  if (Platform.OS === "web" || !Notifications) return "unavailable";
  try {
    // Канал — ДО вопроса: Android 13+ без единого канала окно разрешения
    // (POST_NOTIFICATIONS) не показывает вовсе.
    await ensureAndroidChannel();
    let permission = await Notifications.getPermissionsAsync();
    // Системный вопрос — один раз за установку: после ответа iOS и Android
    // второго окна не показывают, дальше разрешение меняют в настройках.
    if (!permission.granted && permission.canAskAgain && options.askOnce) {
      permission = await Notifications.requestPermissionsAsync();
    }
    if (!permission.granted) return "denied";
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: projectId() });
    const { data, error } = await supabase.rpc("register_push_device", {
      p_token: token,
      p_platform: Platform.OS === "android" ? "android" : "ios",
      p_locale: uiLocale(),
    });
    if (error) return "unavailable";
    const live = Boolean((data as { live?: unknown } | null)?.live);
    const storage = getStorage();
    storage.setRaw(TOKEN_KEY, token);
    storage.set(LIVE_KEY, live);
    return "registered";
  } catch {
    // Нет сети, нет ключей FCM в сборке Android, симулятор без APNs —
    // приложение работает как раньше, с опросом журнала.
    return "unavailable";
  }
}

/** Ждать сервер дольше трёх секунд на выходе нельзя: офлайн — обычное
 *  состояние телефона, а выход обязан сработать. */
function withTimeout(work: Promise<unknown>): Promise<void> {
  return Promise.race([
    work.then(() => undefined, () => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, 3000)),
  ]);
}

function forgetLocal(): void {
  try {
    const storage = getStorage();
    storage.remove(TOKEN_KEY);
    storage.remove(LIVE_KEY);
  } catch {
    // Хранилище подметут следом при выходе.
  }
}

/** Перед выходом из аккаунта на этом телефоне: пуши сюда больше не идут. */
export async function forgetThisDevice(): Promise<void> {
  const token = storedToken();
  forgetLocal();
  if (!token) return;
  await withTimeout(Promise.resolve(supabase.rpc("unregister_push_device", { p_token: token })));
}

/** «Выйти на других устройствах»: их сессии отозваны — и пуши туда тоже. */
export async function forgetOtherDevices(): Promise<void> {
  await withTimeout(
    Promise.resolve(
      supabase.rpc("unregister_push_device", { p_token: storedToken() ?? "", p_other_devices: true }),
    ),
  );
}

/** Открыт календарь — новое за день прочитано: значок гаснет и здесь, и на
 *  сервере (иначе следующий пуш вернул бы вчерашнюю цифру плюс один). */
export async function clearPushBadge(): Promise<void> {
  const Notifications = getNotificationsModule();
  if (Platform.OS === "web" || !Notifications) return;
  await Notifications.setBadgeCountAsync(0).catch(() => false);
  await withTimeout(Promise.resolve(supabase.rpc("reset_push_badge")));
}
