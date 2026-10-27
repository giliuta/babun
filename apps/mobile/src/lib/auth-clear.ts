import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { getStorage } from "@babun/shared/storage";
import { memberQueueDepth, queueDepth } from "@babun/shared/db/cache/sql";
import { confirmAction } from "@/lib/confirm";
import { queryClient } from "@/lib/query-client";
import { unsentChangesNote } from "@/lib/unsent-changes";
import { notify } from "./notify";
import { supabase } from "@/lib/supabase";
import {
  ACTIVE_TENANT_KEY_PREFIX,
  PENDING_CLAIM_KEY_PREFIX,
  forgetActiveTenantId,
  restoreActiveTenantId,
  setActiveTenantId,
} from "@/lib/active-tenant";
import { settleClaimDebt } from "@/lib/claim-catch-up";
import {
  babunNotificationRegistrySnapshot,
  suspendAllBabunNotifications,
} from "@/lib/notifications";
import { forgetOtherDevices, forgetThisDevice } from "@/lib/push-device";
import {
  LAST_USER_KEY,
  consumeSignedOutOnPurpose,
  wipeTenantScopedData,
} from "./auth-clear/wipe";

export { wipeTenantScopedData } from "./auth-clear/wipe";

// Wipe device-local data when this device must no longer see the previous
// account's data. Originally ported from the Next.js web app's
// src/lib/sync/auth-clear.ts; that app is gone, so this file is now the only
// implementation and the canon — there is nothing left to keep in sync with.
//
// The shared local stores persist under GLOBAL (non-tenant-scoped) MMKV keys
// («babun-chats», «babun-appointments», …), so without
// a wipe Tenant B logging in on the same phone inherits Tenant A's chats,
// finances and reference books — the cross-tenant leak first tracked on web.
//
// Wipe semantics (inherited from web v504 + STORY-072/078, now the canon):
//   * intentional logout        → wipe after a SUCCESSFUL signOut
//     (signOutAndWipe below — a failed signOut must not destroy data);
//   * SIGNED_IN, different user → wipe (covers «register a new account
//     without logging out first»);
//   * bare SIGNED_OUT event     → NO data wipe. Supabase fires spurious
//     SIGNED_OUT pairs on refresh-token network blips; wiping there repeatedly
//     nuked real user data on web (v504). Native notifications ARE suspended
//     immediately so a revoked/expired session cannot keep exposing client PII.
//     Their logical queue survives and can be restored after a transient blip.
//
// The wipe (kept keys, query-cache sweep, SQLite) lives in `./auth-clear/wipe.ts`.

// Supabase publishes SIGNED_OUT before an awaiting UI handler necessarily
// finishes its local cleanup. SessionProvider waits on this barrier so the
// login tree cannot mount (and another account cannot sign in) while the old
// tenant's SQLite queue is still present.
let intentionalSignOutBarrier: Promise<void> | null = null;

/** The sentence about changes still waiting in the sync queue, or null when
 *  nothing would be lost (an unreadable cache has nothing to lose either). */
export async function unsentChangesNow(): Promise<string | null> {
  try {
    // Обе очереди: правки таблиц владельца и отложенные вызовы сотрудника —
    // выход стирает их вместе.
    return unsentChangesNote((await queueDepth()) + (await memberQueueDepth()));
  } catch {
    return null;
  }
}

/** Intentional «Выйти» — sign out FIRST, wipe only once the session is
 *  really gone. auth-js signOut() does NOT throw: on a network failure
 *  (offline is a normal mobile state) it returns { error } and KEEPS the
 *  local session — wiping before it would destroy device-only data
 *  (chats and other on-device records) while leaving the user logged in with
 *  empty screens. The wipe still runs before any next sign-in, so a
 *  shared device never leaks this account's cached data.
 *
 *  THIS DEVICE ONLY (`scope: "local"`). It used to be
 *  `"global"`: «Выйти» on one phone revoked the account's sessions on every
 *  other device and did exactly what «Выйти со всех устройств» does. The
 *  global sign-out stays one explicit row in «Вход и безопасность»
 *  (`cabinet/account.tsx`); `sign-out-contract.test.ts` holds both.
 *
 *  UNSENT CHANGES ASK FIRST: the wipe takes the sync
 *  queue with it, so a non-empty queue needs an explicit «Выйти». */
export async function signOutAndWipe(): Promise<void> {
  const unsent = await unsentChangesNow();
  if (
    unsent &&
    !(await confirmAction("Не всё отправлено", {
      message: unsent,
      confirmLabel: "Выйти",
      destructive: true,
    }))
  ) {
    return;
  }
  try {
    await signOutScopeAndWipe("local");
  } catch {
    notify(
      "Не удалось выйти",
      "Проверьте соединение и попробуйте ещё раз.",
    );
  }
}

/** «ВЫЙТИ ИЗ АККАУНТА» В КАБИНЕТЕ — ВСЕГДА С ВОПРОСОМ.
 *  Выход срабатывал с одного тапа и стирал с телефона напоминания «Напомнить»
 *  — они живут только здесь и после входа не вернутся. Вопрос один: в нём же
 *  и про неотправленные правки, второго окна нет. Остальные выходы
 *  («Вы больше не состоите…», чужое приглашение) зовут `signOutAndWipe`. */
export async function confirmAndSignOut(): Promise<void> {
  const unsent = await unsentChangesNow();
  const parts = ["Выход — только на этом телефоне."];
  if (babunNotificationRegistrySnapshot().length > 0) {
    parts.push("Напоминания, поставленные на этом телефоне, удалятся.");
  }
  if (unsent) parts.push(unsent);
  const ok = await confirmAction("Выйти из аккаунта?", {
    message: parts.join(" "),
    confirmLabel: "Выйти",
    destructive: true,
  });
  if (!ok) return;
  try {
    await signOutScopeAndWipe("local");
  } catch {
    notify(
      "Не удалось выйти",
      "Проверьте соединение и попробуйте ещё раз.",
    );
  }
}

/** Intentional sign-out primitive for flows that own their own error UI. */
export async function signOutScopeAndWipe(
  scope: "global" | "local",
): Promise<void> {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  intentionalSignOutBarrier = barrier;
  try {
    // ПУШИ — ДО ВЫХОДА: после него сессии для запроса уже нет, а сервер
    // продолжал бы слать на этот телефон клиентов вышедшего человека.
    if (scope === "global") await forgetOtherDevices();
    await forgetThisDevice();
    const { error } = await supabase.auth.signOut({ scope });
    if (error) throw new Error(error.message);
    await wipeTenantScopedData();
  } finally {
    release();
    if (intentionalSignOutBarrier === barrier) {
      intentionalSignOutBarrier = null;
    }
  }
}

/** Called from the serialized SessionProvider transition on SIGNED_OUT. */
export async function waitForIntentionalSignOutWipe(): Promise<void> {
  await intentionalSignOutBarrier;
}

/** Fed every onAuthStateChange event by SessionProvider. On a concrete user
 *  mismatch the promise resolves only after MMKV, React Query, SQLite and the
 *  offline queue are empty. SessionProvider deliberately waits for it before
 *  exposing the next session to route/query trees. */
export async function handleAuthEvent(
  event: AuthChangeEvent,
  session: Session | null,
): Promise<void> {
  if (event === "SIGNED_OUT") {
    // Выбор компании гасится в ПАМЯТИ немедленно, ещё до чистки: следующий
    // запрос не имеет права уйти с заголовком компании вышедшего человека.
    // Сам ключ в MMKV переживает подмёт намеренно (`KEEP_PREFIXES`) — он
    // именной, и вернувшийся в свой аккаунт попадает туда, где был.
    forgetActiveTenantId();
    await suspendAllBabunNotifications();
    await waitForIntentionalSignOutWipe();
    return;
  }
  if (event === "INITIAL_SESSION" && !session) {
    await suspendAllBabunNotifications();
    return;
  }
  // PASSWORD_RECOVERY — тоже вход: ссылка сброса из письма
  // заводит сессию своего человека (`verifyOtp` шлёт это событие, а не
  // SIGNED_IN). Без этой строки вход по ссылке B поверх данных A,
  // оставшихся после выхода «со всех устройств» на другом телефоне, сверку
  // человека пропускал — и B видел кэш A.
  if (
    event !== "SIGNED_IN" &&
    event !== "INITIAL_SESSION" &&
    event !== "PASSWORD_RECOVERY"
  ) {
    return;
  }
  const next = session?.user?.id;
  if (!next) return;
  const storage = getStorage();
  const prev = storage.getRaw(LAST_USER_KEY);
  if (prev && prev !== next) {
    // СМЕНИЛСЯ ЧЕЛОВЕК — не компания. Здесь чистится всё, включая SQLite и
    // очередь: устройство не имеет права помнить ни строки прежнего аккаунта.
    // И выбор компании прежнего человека тоже уходит — его ключ именной,
    // поэтому подметается адресно, а не общим префиксом.
    forgetActiveTenantId();
    for (const prefix of [ACTIVE_TENANT_KEY_PREFIX, PENDING_CLAIM_KEY_PREFIX]) {
      for (const key of storage.list(prefix)) {
        if (key !== `${prefix}${next}`) storage.remove(key);
      }
    }
    // Настройки, помнящиеся по компании, здесь уходят вместе со всем
    // остальным: `wipeTenantScopedData` без `keepLocalCache` подметает по
    // префиксу и их тоже. Отдельного вызова не нужно — компанию они называют,
    // а человека нет, и на общем телефоне оставлять их нельзя.
    await wipeTenantScopedData();
  }
  if (prev !== next) storage.setRaw(LAST_USER_KEY, next);

  // Тот же человек после выхода: сессия ещё не опубликована, на экране
  // логин, значит всё, что без подписчиков, — хвост вышедших страниц.
  // Удаление гасит и повторы запросов, отбитых заслонкой в том окне.
  if (consumeSignedOutOnPurpose()) {
    if (prev === next) queryClient.removeQueries({ type: "inactive" });
  }

  // УСТРОЙСТВО ЗАПОМИНАЕТ СВОЙ ВЫБОР С ПЕРВОГО ЖЕ ЗАПУСКА.
  //
  // Без этой строки телефон, который ещё ни разу не переключался, не имеет
  // своего выбора и читает компанию из токена — а токен один на аккаунт.
  // Значит переключение на планшете уводило бы и телефон: ровно та жалоба, от
  // которой мы уходим. Поэтому первый вход закрепляет на устройстве ту
  // компанию, которая в токене сейчас, и дальше устройство живёт само.
  const restored = restoreActiveTenantId(next);
  if (!restored.tenantId && restored.readable) {
    const claimed = (
      session?.user?.app_metadata as { tenant_id?: unknown } | undefined
    )?.tenant_id;
    if (typeof claimed === "string" && claimed) {
      setActiveTenantId(next, claimed);
    }
  }
  // Хранилище не ответило (Keychain ещё заперт) — НЕ засеваем из токена: он
  // называет компанию, выбранную на ДРУГОМ устройстве, и один такой засев
  // закрепил бы её здесь поверх настоящего выбора, который просто ещё не
  // прочитался. До следующего события сервер отвечает по токену, как раньше.

  // ХОЛОДНЫЙ СТАРТ — ОДНА ИЗ ТОЧЕК, ГДЕ ГАСИТСЯ ДОЛГ ПО ТОКЕНУ: переход мог
  // случиться без сети, и claim в токене всё ещё называет прежнюю компанию.
  void settleClaimDebt();
}
