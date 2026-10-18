import { useEffect, useRef } from "react";
import { View } from "react-native";
import { uiLocale } from "@babun/shared/i18n/locale";

import { GOOGLE_WEB_CLIENT_ID, signInWithGoogleIdToken, type SocialResult } from "./social-sign-in";

// «ПРОДОЛЖИТЬ С GOOGLE» НА САЙТЕ — КНОПКОЙ GOOGLE IDENTITY SERVICES.
// Переход на страницу Google показывал «продолжить на …supabase.co»; кнопка
// GIS открывает окно Google поверх babun.app и пишет «Войти в babun.app».
// Она отдаёт id-токен, его меняет на сессию `signInWithIdToken`. Вид кнопки
// рисует сам Google (так требуют его правила) — только светлый контур, ширина
// по колонке формы, язык интерфейса.
//
// Защита от повтора токена — nonce: Google получает его SHA-256, Supabase —
// исходную строку и сверяет.

type Gsi = {
  accounts: {
    id: {
      initialize: (options: Record<string, unknown>) => void;
      renderButton: (el: HTMLElement, options: Record<string, unknown>) => void;
    };
  };
};

const GSI_SRC = "https://accounts.google.com/gsi/client";
let loading: Promise<Gsi> | null = null;

function loadGsi(): Promise<Gsi> {
  const ready = (window as unknown as { google?: Gsi }).google;
  if (ready?.accounts?.id) return Promise.resolve(ready);
  if (!loading) {
    loading = new Promise<Gsi>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = GSI_SRC;
      script.async = true;
      script.onload = () => {
        const gsi = (window as unknown as { google?: Gsi }).google;
        if (gsi?.accounts?.id) resolve(gsi);
        else reject(new Error("Google Identity Services failed to load"));
      };
      script.onerror = () => {
        loading = null;
        reject(new Error("Google Identity Services failed to load"));
      };
      document.head.appendChild(script);
    });
  }
  return loading;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function GoogleWebButton({ onResult }: { onResult: (result: SocialResult) => void }) {
  const host = useRef<View>(null);
  const report = useRef(onResult);
  report.current = onResult;

  useEffect(() => {
    let alive = true;
    void (async () => {
      const gsi = await loadGsi();
      const el = host.current as unknown as HTMLElement | null;
      if (!alive || !el) return;
      const nonce = crypto.randomUUID();
      gsi.accounts.id.initialize({
        client_id: GOOGLE_WEB_CLIENT_ID,
        nonce: await sha256Hex(nonce),
        callback: (response: { credential?: string }) => {
          if (!response.credential) return;
          void signInWithGoogleIdToken(response.credential, nonce).then((r) => report.current(r));
        },
        use_fedcm_for_button: true,
        itp_support: true,
      });
      gsi.accounts.id.renderButton(el, {
        type: "standard",
        theme: "outline",
        size: "large",
        text: "continue_with",
        shape: "rectangular",
        logo_alignment: "center",
        width: Math.min(400, Math.max(200, el.offsetWidth || 360)),
        locale: uiLocale(),
      });
    })().catch(() => report.current({ ok: false, cancelled: false }));
    return () => {
      alive = false;
    };
  }, []);

  return <View ref={host} style={{ minHeight: 44, alignItems: "center" }} />;
}
