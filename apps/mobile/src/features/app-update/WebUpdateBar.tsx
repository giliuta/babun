import { useEffect, useState, type ReactNode } from "react";
import { Platform, View } from "react-native";
import { SafeAreaInsetsContext, useSafeAreaInsets } from "react-native-safe-area-context";
import { NoticeBar } from "@/components/ui/NoticeBar";
import {
  WEB_BUILD_CHECK_MS,
  bundleIdOf,
  dropStaleServiceWorkers,
  isNewBuild,
  runningBundleIds,
} from "./web-build";

// «ДОСТУПНА НОВАЯ ВЕРСИЯ» В ВЕБЕ. Правило — `web-build.ts`. Сверка — при
// возврате на вкладку и раз в десять минут, пока она открыта. Перезагрузка —
// только по нажатию «Обновить»: сама она посреди ввода стёрла бы набранное.
// Плашка стоит над приложением, а не поверх: ничего не закрывает.

function useNewWebBuild(): boolean {
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const running = runningBundleIds(document.scripts);
    if (running.length === 0) return;
    let alive = true;
    const check = () => {
      if (document.visibilityState === "hidden") return;
      void fetch(`/?build=${Date.now()}`, { cache: "no-store" })
        .then((res) => (res.ok ? res.text() : ""))
        .then((html) => {
          if (alive && isNewBuild(running, bundleIdOf(html))) setFresh(true);
        })
        .catch(() => {});
    };
    const timer = setInterval(check, WEB_BUILD_CHECK_MS);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  return fresh;
}

/** Приложение с плашкой новой версии сверху (только веб). Обёртка стоит
 *  ВСЕГДА, плашка лишь встаёт перед ней: смени дерево форму в момент
 *  появления плашки — React пересоздал бы весь экран вместе с набранным. */
export function WebUpdateShell({ children }: { children: ReactNode }) {
  const fresh = useNewWebBuild();
  useEffect(() => {
    if (Platform.OS !== "web" || typeof navigator === "undefined") return;
    const cacheStore = typeof caches === "undefined" ? undefined : caches;
    void dropStaleServiceWorkers(navigator.serviceWorker, cacheStore).catch(() => {});
  }, []);
  const insets = useSafeAreaInsets();
  return (
    <>
      {fresh ? (
        <View style={{ paddingTop: insets.top }}>
          <NoticeBar
            tone="info"
            message="Доступна новая версия"
            action={{ label: "Обновить", onPress: () => window.location.reload() }}
          />
        </View>
      ) : null}
      {/* Верх экрана занят плашкой — экраны под ней свой отступ не
          добавляют (как под плашкой режима «его глазами»). */}
      <SafeAreaInsetsContext.Provider value={fresh ? { ...insets, top: 0 } : insets}>
        {children}
      </SafeAreaInsetsContext.Provider>
    </>
  );
}
