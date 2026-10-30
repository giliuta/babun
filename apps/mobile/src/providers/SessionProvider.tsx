import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { setShownSessionUserId } from "@/lib/active-tenant";
import { clearQueriesLeftBySignOut, handleAuthEvent } from "@/lib/auth-clear";
import { queryClient } from "@/lib/query-client";
import { supabase } from "@/lib/supabase";
import { needsSecondStep } from "@/lib/mfa/assurance";
import { shouldPublishSession, signedOutNow } from "./session-publish";

type SessionState = {
  session: Session | null;
  loading: boolean;
  /** Вошёл первым шагом, ждём код из приложения-аутентификатора. Сессия
   *  до кода наружу не отдаётся: для всего приложения человек ещё не вошёл,
   *  и гейт входа ведёт на экран кода (`(auth)/mfa`). */
  secondStepPending: boolean;
};

const SessionContext = createContext<SessionState>({
  session: null,
  loading: true,
  secondStepPending: false,
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [secondStepPending, setSecondStepPending] = useState(false);

  useEffect(() => {
    let mounted = true;
    // Auth callbacks may arrive back-to-back (INITIAL_SESSION followed by a
    // refresh or an explicit SIGNED_IN). Serialising them prevents an older
    // async tenant wipe from publishing its session after a newer event.
    let transition = Promise.resolve();

    const applySession = (event: AuthChangeEvent, next: Session | null) => {
      transition = transition
        .then(async () => {
          await handleAuthEvent(event, next);
          if (!mounted) return;
          // ДВУХФАКТОРНЫЙ ВХОД: сессия первого шага до кода не публикуется —
          // ни дашборд, ни один его запрос не стартует с токеном `aal1`.
          const pending = needsSecondStep(next);
          setSecondStepPending(pending);
          // Обновлённый токен того же человека дерево не перерисовывает:
          // экраны читают из сессии человека, а не токен (`session-publish.ts`).
          setSession((prev) =>
            pending ? null : shouldPublishSession(event, prev, next) ? next : prev,
          );
          setLoading(false);
        })
        .catch(() => {
          // A local cache wipe failure must fail closed. Keeping the app at
          // the signed-out gate is safer than exposing another tenant's data.
          if (!mounted) return;
          setSession(null);
          setSecondStepPending(false);
          setLoading(false);
        });
    };

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted) return;
        applySession("INITIAL_SESSION", data.session);
      })
      .catch(() => {
        // Keychain read failed — treat as signed out instead of hanging the
        // RootNavigator (and the splash screen) in `loading` forever. Route
        // this through the same privacy transition so native reminders are
        // suspended even when auth storage itself is unreadable.
        if (mounted) applySession("INITIAL_SESSION", null);
      });

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      applySession(event, next);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Заслонка анонимного запроса держится, пока на экране страницы вошедшего:
  // выбор компании в памяти гаснет на выходе раньше, чем дерево уходит на
  // логин (`active-tenant.ts`). Ставится после отрисовки — дочерние
  // эффекты той же отрисовки ещё видят прежнего и отбиваются, а не уходят
  // анонимом.
  const shownUserId = session?.user?.id ?? null;
  const shownBefore = useRef<string | null>(null);
  useEffect(() => {
    setShownSessionUserId(shownUserId);
    // Повторы запросов вышедшего ушли бы анонимом (`signedOutNow`). Запросы,
    // которые «Выйти» оставило страницам вышедшего, сносятся только сейчас:
    // на экране логин, и пересоздавать их некому (`auth-clear/wipe.ts`).
    if (signedOutNow(shownBefore.current, shownUserId)) {
      void queryClient.cancelQueries();
      clearQueriesLeftBySignOut();
    }
    shownBefore.current = shownUserId;
  }, [shownUserId]);

  return (
    <SessionContext.Provider value={{ session, loading, secondStepPending }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  return useContext(SessionContext);
}
