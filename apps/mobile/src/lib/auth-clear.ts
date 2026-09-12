import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { getStorage } from "@babun/shared/storage";
import { cacheClearAll } from "@babun/shared/db/cache/sql";
import { queryClient } from "@/lib/query-client";
import { notify } from "./notify";
import { supabase } from "@/lib/supabase";
import {
  ACTIVE_TENANT_KEY_PREFIX,
  PENDING_CLAIM_KEY_PREFIX,
  forgetActiveTenantId,
  restoreActiveTenantId,
  setActiveTenantId,
} from "@/lib/active-tenant";
import { isTenantScopedKey } from "@/lib/tenant-prefs";
import { querySurvivesSwitch } from "@/lib/tenant-query-keys";
import { settleClaimDebt } from "@/lib/claim-catch-up";
import { notificationsForWipe } from "@/lib/wipe-plan";
import {
  clearAllBabunNotifications,
  suspendAllBabunNotifications,
} from "@/lib/notifications";

// Wipe device-local data when this device must no longer see the previous
// account's data. Originally ported from the Next.js web app's
// src/lib/sync/auth-clear.ts; that app is gone, so this file is now the only
// implementation and the canon — there is nothing left to keep in sync with.
//
// The shared local stores persist under GLOBAL (non-tenant-scoped) MMKV keys
// («babun-chats», «babun-appointments», «babun:closed-day:*», …), so without
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

// Every Babun-owned key starts with one of these — a prefix sweep catches new
// modules automatically (no «we forgot to add the key» follow-ups).
const TENANT_PREFIXES = ["babun-", "babun2:", "babun:", "calendar."];

// Identity stamp — must SURVIVE the wipe so the next sign-in can detect a
// different account (the LAST_USER_KEY / KEEP_KEYS pair carried over from web).
const LAST_USER_KEY = "babun:auth:last-user-id";
const KEEP_KEYS = new Set<string>([LAST_USER_KEY]);

// Выбранная компания тоже переживает чистку: при переходе она и есть то, ради
// чего переход случился, — стереть её значит вернуть человека туда, откуда он
// ушёл. Аккаунт при этом меняется РЕДКО, и тогда ключ уносит ветка ниже
// (`handleAuthEvent`), а не общий подмёт.
const KEEP_PREFIXES = [ACTIVE_TENANT_KEY_PREFIX, PENDING_CLAIM_KEY_PREFIX];

// Supabase publishes SIGNED_OUT before an awaiting UI handler necessarily
// finishes its local cleanup. SessionProvider waits on this barrier so the
// login tree cannot mount (and another account cannot sign in) while the old
// tenant's SQLite queue is still present.
let intentionalSignOutBarrier: Promise<void> | null = null;

// ДВА РЕЖИМА ЧИСТКИ, И ВЫБОР МЕЖДУ НИМИ — НЕ ВКУС.
//
// `queryClient.clear()` сносит САМИ запросы. Экран, подписанный на такой
// запрос, остаётся с замороженным снимком «идёт загрузка» и никогда не узнаёт,
// что загрузка кончилась: будить некого, объекта больше нет.
//
// Пока чистка случалась только на выходе из аккаунта, это не стреляло: дерево
// уходит на логин, подписчиков не остаётся. Выстрелило, когда чистка пошла
// СЕРЕДИНОЙ сессии — при переходе в другую компанию: гейт «Открываем
// компанию» висел шестьдесят секунд при пяти секундах самой работы, потому
// что ответ пришёл, а сказать о нём было некому (замер 2026-09-12).
//
// Поэтому чистка посреди работы СБРАСЫВАЕТ запросы, а не сносит: данных
// прежней компании сброс так же не оставляет, но подписчики остаются живыми и
// узнают, что данных больше нет. На выходе из аккаунта остаётся `clear()` —
// там сброс означал бы залп запросов без сессии.
function wipeFastStores(
  keepSubscribers: boolean,
  keepTenantNamedKeys = false,
  knownTenantIds?: readonly string[],
): void {
  const storage = getStorage();
  for (const key of storage.list()) {
    if (KEEP_KEYS.has(key)) continue;
    if (KEEP_PREFIXES.some((p) => key.startsWith(p))) continue;
    // ПЕРЕХОД В ДРУГУЮ КОМПАНИЮ НЕ СНОСИТ КЛЮЧИ, КОТОРЫЕ КОМПАНИЮ НАЗЫВАЮТ.
    //
    // Такой ключ безопасен по построению: под другой компанией его просто не
    // прочитают — имя не совпадёт. А снос превращал «настройку компании» в
    // «настройку до первого переключения»: способы связи, блоки записи, карты,
    // шаблоны SMS и вид календаря возвращались к умолчаниям на каждом переходе,
    // хотя все они уже давно носят компанию в имени. Список — в `tenant-prefs`.
    //
    // На выходе из аккаунта они уходят вместе со всем остальным: компанию они
    // называют, а ЧЕЛОВЕКА нет, и на общем телефоне их оставлять нельзя.
    if (keepTenantNamedKeys && isTenantScopedKey(key)) continue;
    if (TENANT_PREFIXES.some((p) => key.startsWith(p))) storage.remove(key);
  }
  if (!keepSubscribers) {
    queryClient.clear();
    return;
  }

  // ПЕРЕХОД НЕ ВЫБРАСЫВАЕТ ДАННЫЕ КОМПАНИИ, В КОТОРУЮ ИДЁТ.
  //
  // Владелец 2026-09-12: «всё равно очень долго открывается, должно
  // моментально — сразу топаю на Команду 1, и сразу видно записи». Замер
  // показал не медленную сеть, а СКЕЛЕТ: после перехода календарь рисовал
  // серые заглушки вместо дат и записей.
  //
  // Виноват был `resetQueries()`. Она стирает данные У ВСЕХ запросов — включая
  // те, что принадлежат компании, КУДА мы переходим и которые лежали готовыми
  // с прошлого захода. То есть каждое переключение делалось холодным на
  // ровном месте: данные были, их выбрасывали, и человек ждал сеть.
  //
  // Выбрасывать всё подряд и не требовалось: 59 ключей из 69 НАЗЫВАЮТ
  // компанию (`["appointments", tenantId, role]`), а такой запрос чужого не
  // покажет по построению — под другой компанией у него другой ключ.
  //
  // Поэтому: запросы ЛЮБОЙ из компаний человека остаются и рисуются
  // НЕМЕДЛЕННО, а помечаются протухшими и досчитываются в фоне. Всё остальное
  // сносится — сюда попадает и `["client", id]`, ключ которого компанию не
  // называет и потому мог бы показать карточку клиента прежней фирмы.
  //
  // ЛЮБОЙ, А НЕ ТОЛЬКО ТОЙ, КУДА ИДЁМ — это правка второй попытки. Первая
  // берегла лишь компанию назначения и тем самым стирала кэш той, откуда
  // уходим: круг «AirFix → Giliuta → AirFix» оставался холодным на обратном
  // пути, и владелец снова видел скелет. Поймано на симуляторе.
  if (knownTenantIds?.length) {
    queryClient.removeQueries({
      predicate: (q) => !querySurvivesSwitch(q.queryKey, knownTenantIds),
    });
    // `refetchType: "none"` — ПОМЕТИТЬ ПРОТУХШИМ, НО НЕ ПЕРЕЗАПРАШИВАТЬ, и это
    // правка потери данных, а не оптимизация.
    //
    // По умолчанию `invalidateQueries()` немедленно перезапрашивает активные
    // запросы. В этот момент запрос ПРЕЖНЕЙ компании ещё смонтирован, а её
    // `tenantId` закрыт у него в замыкании — и уходит он уже с НОВЫМ
    // заголовком. Сервер честно отвечает нулём строк (компания в фильтре одна,
    // а заголовок называет другую), и обёртка кэша принимает это за
    // авторитетный ответ: `cacheReplaceTenant` УДАЛЯЕТ строки прежней компании
    // и ставит метку «сервер сказал: пусто». Возврат в неё снова холодный, а
    // офлайн она показывает пустой день — ровно то, ради чего мы и перестали
    // сносить SQLite.
    //
    // Перезапрашивать здесь и не нужно: экран уже перерисовывается с новой
    // компанией, а у её запросов ДРУГИЕ ключи — они сходят в сеть сами, при
    // монтировании. Запросы прежней компании становятся неактивными и молчат.
    void queryClient.invalidateQueries({ refetchType: "none" });
    return;
  }

  // Компания неизвестна (чистка не из перехода) — прежнее поведение.
  void queryClient.resetQueries();
}

/** Убирает с устройства всё, что помнило прежнюю компанию, и ЖДЁТ, пока это
 *  случится: при переходе в другую компанию следующий токен не имеет права
 *  ничего нарисовать, пока живы MMKV, кэш запросов и офлайн-очередь прежней.
 *
 *  `keepSubscribers` обязателен, когда чистка идёт ПОСРЕДИ работающей сессии
 *  (тот самый переход): иначе смонтированные экраны застынут на «загрузке»
 *  навсегда — объяснение над `wipeFastStores`.
 *
 *  `keepLocalCache` — ТОЖЕ про переход, и это про сохранность работы. Разбор
 *  над `cacheClearAll` ниже. */

export async function wipeTenantScopedData(
  opts: {
    keepSubscribers?: boolean;
    keepLocalCache?: boolean;
    /** ВСЕ компании человека. Запросы, чьи ключи их называют, не
     *  выбрасываются — см. разбор выше; без списка чистка ведёт себя как
     *  прежде. Беречь ТОЛЬКО компанию назначения нельзя: так стирается кэш
     *  той, откуда уходим, и обратный путь снова холодный. */
    knownTenantIds?: readonly string[];
  } = {},
): Promise<void> {
  // ОТМЕНА НЕ ЖДЁТСЯ, И ЭТО ГЛАВНАЯ СТРОКА ПО СКОРОСТИ ПЕРЕХОДА.
  //
  // `cancelQueries()` возвращает обещание, которое исполняется, когда УЖЕ
  // ОТПРАВЛЕННЫЕ запросы отменятся или доедут. Запросы supabase сигнала отмены
  // не принимают, поэтому «отменятся» для них означает «доедут»: `await` здесь
  // держал переход до конца летящих сейчас поездок. Замер на симуляторе —
  // 695 мс из 981 мс всего перехода, и это на быстрой сети; на телефоне в поле
  // столько же будет стоить одна поездка.
  //
  // Ждать незачем. Поздний ответ компании, которую мы покидаем, ложится в
  // ключ, НАЗЫВАЮЩИЙ её, — под новой компанией такой ключ никто не читает, а
  // мы его теперь и не сносим. Ключи без компании сносятся ниже, и поздний
  // ответ в снесённый запрос никто не отрисует.
  void queryClient.cancelQueries();

  // НАТИВНЫЕ УВЕДОМЛЕНИЯ ГАСНУТ ПЕРВЫМИ — иначе на локскрине остаются имена
  // клиентов компании, из которой человек уже ушёл. Это условие не обсуждается
  // и держится контрактом `notification-privacy-contract.test.ts`.
  //
  // А вот СПИСОК напоминаний при переходе остаётся жив, и это правка бага:
  // `clearAllBabunNotifications` уносит реестр целиком, то есть переключение в
  // другую компанию безвозвратно стирало напоминания, выставленные руками, — у
  // ОБЕИХ компаний сразу. Человек возвращался к себе, а «позвонить клиенту в
  // 9:00» больше не существовало. `suspend` снимает доставку, но оставляет
  // список, и он восстанавливается, как только компания снова открыта.
  if (notificationsForWipe(opts) === "clear") {
    await clearAllBabunNotifications();
  }

  wipeFastStores(
    opts.keepSubscribers ?? false,
    opts.keepLocalCache ?? false,
    opts.knownTenantIds,
  );

  // ПЕРЕХОД В ДРУГУЮ КОМПАНИЮ НЕ СНОСИТ SQLite, И ЭТО НЕ ПОСЛАБЛЕНИЕ.
  //
  // `cacheClearAll()` бьёт по ВСЕМ пяти таблицам разом, а строки в них уже
  // разложены по компаниям: `clients`, `appointments` и `tags` несут колонку
  // `tenant_id` с индексом, и запрос другой компании их и так не читает.
  // Значит снос ничего не защищает — он только заставляет заново скачать всё
  // при возврате назад. Именно это владелец чувствует как «лаг» на ВТОРОМ
  // переключении: первое качает одну компанию, второе — снова обе.
  //
  // Отдельно про `sync_queue`, и это уже не про скорость, а про потерю
  // работы. Очередь несохранённых операций ГЛОБАЛЬНА, и снос уносил из неё всё
  // подряд, включая то, что человек только что набрал в прежней компании.
  // Защитой это не было никогда: `sync/replayer.ts` сам сверяет
  // `payload.tenant_id` с активной компанией и чужие операции не выгружает, а
  // ОСТАВЛЯЕТ в очереди (tenant-gate, offline-plan risk #1). То есть граница
  // между компаниями держится у выгрузки, а чистка лишь уничтожала работу до
  // того, как её успели отправить.
  //
  // На выходе из аккаунта снос остаётся обязательным: там устройство не имеет
  // права помнить ни строки — это и есть межтенантная защита.
  if (opts.keepLocalCache) return;
  try {
    await cacheClearAll();
  } catch {
    // SQLite is not injected on Expo web/pre-bootstrap. MMKV + Query remain
    // cleared, and native bootstrap always injects before a user can switch.
  }
}

/** Drop every tenant-scoped local key + the in-memory query cache + the
 *  SQLite offline cache (clients / appointments / tags / sync_queue /
 *  sync_meta). Without the SQLite wipe, Tenant A's cached rows AND — worse
 *  — A's un-drained sync_queue ops survive a logout→login-B on the same
 *  device: those ops would replay onto the server under B's session
 *  (cross-tenant leak, offline-plan risk #1). This compatibility helper keeps
 *  the old fire-and-forget shape for post-deletion/global-signout call sites;
 *  normal logout and account-switch guards use wipeTenantScopedData() and
 *  await the SQLite clear before another session can render. */
export function wipeLocalData(): void {
  void clearAllBabunNotifications();
  wipeFastStores(false);
  void cacheClearAll().catch(() => {
    // Cache not injected yet (SqlAdapter set only on native bootstrap) or a
    // transient SQLite error — swallow. The cross-tenant leak this guards
    // only materialises once slice 4 wires mutations onto the wrappers; on
    // web / pre-bootstrap there is nothing to clear.
  });
}

/** Intentional «Выйти» — sign out FIRST, wipe only once the session is
 *  really gone. auth-js signOut() does NOT throw: on a network failure
 *  (offline is a normal mobile state) it returns { error } and KEEPS the
 *  local session — wiping before it would destroy device-only data
 *  (chats, closed-day records) while leaving the user logged in with
 *  empty screens. The wipe still runs before any next sign-in, so a
 *  shared device never leaks this account's cached data. */
export async function signOutAndWipe(): Promise<void> {
  try {
    await signOutScopeAndWipe("global");
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
  if (event !== "SIGNED_IN" && event !== "INITIAL_SESSION") return;
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
