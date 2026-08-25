import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { handleAuthEvent } from "@/lib/auth-clear";
import { supabase } from "@/lib/supabase";

type SessionState = { session: Session | null; loading: boolean };

const SessionContext = createContext<SessionState>({
  session: null,
  loading: true,
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

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
          setSession(next);
          setLoading(false);
        })
        .catch(() => {
          // A local cache wipe failure must fail closed. Keeping the app at
          // the signed-out gate is safer than exposing another tenant's data.
          if (!mounted) return;
          setSession(null);
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

  return (
    <SessionContext.Provider value={{ session, loading }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  return useContext(SessionContext);
}
