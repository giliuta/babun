import { AppState } from "react-native";
import { onlineManager } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  getActiveTenantId,
  getActiveUserId,
  readPendingClaim,
  rememberPendingClaim,
  settlePendingClaim,
} from "@/lib/active-tenant";

// ДОГОН CLAIM'А В ТОКЕНЕ — ДОЛГ, КОТОРЫЙ ГАСИТСЯ, А НЕ ПОПЫТКА, КОТОРАЯ ЗАБЫВАЕТСЯ.
//
// Переход между компаниями мгновенен, потому что экран не ждёт
// `activate_tenant` + `refreshSession`. Но три поверхности заголовка не видят
// и живут по claim'у в токене: realtime, storage (фото, чеки, логотипы) и
// edge-функции. Пока claim не догнал, загрузка фото в новой компании
// отбивается политикой, а realtime слушает прежнюю.
//
// Первая версия делала догон одной попыткой `void catchUp()` и провал
// глотала: переход без сети — и фото с realtime в новой компании были сломаны
// НАВСЕГДА, до следующего удачного перехода. Аудит 2026-09-13 назвал это
// «односторонней дверью».
//
// Теперь долг ЗАПИСЫВАЕТСЯ до попытки (`rememberPendingClaim`) и гасится
// только успехом. Гасят его в четырёх точках, где сеть заведомо вернулась:
// сразу после перехода (с повтором), при возврате приложения на передний
// план, при появлении сети и на холодном старте (`auth-clear.ts`).

const RETRY_DELAYS_MS = [0, 2_000, 8_000];

/** Одна попытка. `true` — claim в токене теперь называет `tenantId`. */
async function tryCatchUp(userId: string, tenantId: string): Promise<boolean> {
  // Штамп «компания настроена» здесь НЕ ставится, хотя `activate_tenant` его
  // возвращает: его уже поставили переход (факт из ленты календарей) и приём
  // приглашения (факт из самого приёма). Импорт `lib/tenant` отсюда замкнул бы
  // круг auth-clear → catch-up → tenant → SessionProvider → auth-clear.
  const { error } = await supabase.rpc("activate_tenant", {
    p_tenant_id: tenantId,
  });
  if (error) return false;
  const { error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) return false;
  settlePendingClaim(userId, tenantId);
  return true;
}

let inFlight: Promise<void> | null = null;

/** Гасит долг, если он есть. Одновременно идёт не больше одной попытки: два
 *  параллельных `refreshSession` ломают друг друга («Не удалось обновить
 *  вход» на уже переключённой компании — так было). Цель берётся ЖИВАЯ на
 *  каждом шаге: если человек успел уйти дальше, догоняем последнюю. */
export function settleClaimDebt(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const userId = getActiveUserId();
      if (!userId) return;
      for (const delay of RETRY_DELAYS_MS) {
        const target = readPendingClaim(userId);
        if (!target) return;
        // Долг мог устареть: человек ушёл дальше, а долг стоит на прежнюю.
        // Гасим то, где он СЕЙЧАС; старый долг снимется как оплаченный,
        // потому что settle сверяет цель.
        const live = getActiveTenantId() ?? target;
        if (live !== target) rememberPendingClaim(userId, live);
        if (delay) await new Promise((r) => setTimeout(r, delay));
        if (await tryCatchUp(userId, live)) return;
      }
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Зовёт переход: записать долг и начать гасить, НЕ дожидаясь. */
export function scheduleClaimCatchUp(userId: string, tenantId: string): void {
  rememberPendingClaim(userId, tenantId);
  void settleClaimDebt();
}

// ТОЧКИ, ГДЕ СЕТЬ ЗАВЕДОМО ВЕРНУЛАСЬ. Подписки живут столько же, сколько
// приложение, — как и слушатель AppState в `supabase.ts`.
AppState.addEventListener("change", (state) => {
  if (state === "active") void settleClaimDebt();
});
onlineManager.subscribe((online) => {
  if (online) void settleClaimDebt();
});
