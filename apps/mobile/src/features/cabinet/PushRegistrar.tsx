import { useEffect } from "react";
import { AppState } from "react-native";
import { registerThisDevice } from "@/lib/push-device";
import { useSession } from "@/providers/SessionProvider";

// ЭТОТ ТЕЛЕФОН — В ПОЛУЧАТЕЛЯХ ПУШЕЙ О ДЕЛАХ КОМАНДЫ. Без интерфейса.
//
// При входе — запись токена (и системный вопрос о разрешении, если его ещё
// не задавали: без него мастер не узнает о новой работе при закрытом
// приложении). Дальше — раз в шесть часов при возвращении в приложение:
// сервер помнит, что телефон жив, и не шлёт на заброшенные.

const REFRESH_MS = 6 * 60 * 60 * 1000;

export function PushRegistrar() {
  const { session } = useSession();
  const me = session?.user?.id ?? null;

  useEffect(() => {
    if (!me) return;
    let last = Date.now();
    void registerThisDevice({ askOnce: true });
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active" || Date.now() - last < REFRESH_MS) return;
      last = Date.now();
      void registerThisDevice();
    });
    return () => sub.remove();
  }, [me]);

  return null;
}
