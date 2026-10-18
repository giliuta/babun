import { useEffect } from "react";
import { Platform } from "react-native";

/** На вебе, пока форма изменена, перезагрузка, закрытие вкладки и ввод
 *  адреса спрашивают браузерным вопросом. `usePreventRemove` ловит только
 *  переходы внутри приложения — без этого F5 молча терял набранное. На
 *  телефоне ничего не делает. */
export function useBeforeUnloadWhileDirty(dirty: boolean): void {
  useEffect(() => {
    if (Platform.OS !== "web" || !dirty || typeof window === "undefined") return;
    const ask = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Старым Safari и Chrome нужен ещё и непустой `returnValue`.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [dirty]);
}
