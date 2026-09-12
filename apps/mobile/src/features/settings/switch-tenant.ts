import { supabase } from "@/lib/supabase";
import { queryClient } from "@/lib/query-client";
import { wipeTenantScopedData } from "@/lib/auth-clear";
import { pauseSyncBridgeForTenantSwitch } from "@/lib/sync-bridge";
import { pauseSyncRuntimeForTenantSwitch } from "@/lib/sync-runtime";
import { markTenantOnboarded } from "@/lib/tenant";

/** `activate_tenant` отдаёт jsonb: роль, карточку мастера и факт онбординга.
 *  Узкий разбор вместо `any` — сгенерированные типы знают только `Json`. */
function isOnboardedResult(value: unknown): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { onboarded?: unknown }).onboarded === true
  );
}

// ПЕРЕХОД В ДРУГУЮ КОМПАНИЮ — ОДНА ТРАНЗАКЦИЯ НА ВЕСЬ ПРОДУКТ.
//
// Человек живёт в нескольких контурах: свой личный календарь и те компании,
// куда его добавили. Переключение между ними — не «поменять переменную»: на
// активном контуре завязаны офлайн-кэш SQLite, очередь несохранённых операций,
// ключи react-query и мост синхронизации. Оставить от предыдущей компании хоть
// один из них значит показать её данные внутри другой.
//
// Порядок шагов выстрадан приёмом приглашения (он же был единственным местом,
// где продукт умел менять компанию) и здесь не меняется:
//
//   1. Остановить мост и рантайм синхронизации — чтобы в момент смены никто
//      не дописывал в кэш старую компанию.
//   2. ПЕРВАЯ чистка — до смены JWT: она уносит несохранённые операции старого
//      контура, пока они ещё принадлежат ему.
//   3. `activate_tenant` — сервер проверяет членство и переставляет
//      `app_metadata.tenant_id`.
//   4. `refreshSession` — забрать новый токен.
//   5. СВЕРКА: в новом токене действительно та компания, о которой просили.
//      Без этой строки «переключились» означало бы «попросили переключиться».
//   6. ВТОРАЯ чистка — ловит ревалидацию старого контура, которая могла
//      завершиться уже после первой, и оставляет все запросы протухшими.
//
// Дальше `SessionProvider` видит TOKEN_REFRESHED и перемонтирует обе жизни
// синхронизации уже с новым tenant id — поэтому на успехе старые НЕ
// возобновляются: возобновить их значило бы дать им дописать в новый контур.

/** Меняет активную компанию и вычищает всё, что помнило предыдущую.
 *
 *  `knownOnboarded` — факт, полученный ЗАРАНЕЕ (`list_my_calendars` отдаёт его
 *  вместе с лентой). С ним штамп ставится в первую же секунду, и гейт
 *  «Открываем компанию» не показывается вовсе: к моменту, когда токен
 *  сменится и экран перерисуется, ответ уже лежит. Без него всё работает как
 *  прежде — штамп встанет в конце, по ответу сервера. */
export async function switchTenant(
  tenantId: string,
  knownOnboarded = false,
): Promise<void> {
  const resumeOldBridge = pauseSyncBridgeForTenantSwitch();
  const resumeRuntime = pauseSyncRuntimeForTenantSwitch();
  let switched = false;
  try {
    await wipeTenantScopedData({ keepSubscribers: true });

    // ШТАМП ВПЕРЁД, ЕСЛИ ФАКТ УЖЕ ИЗВЕСТЕН. Ставится ПОСЛЕ чистки — она сносит
    // ключи с префиксом `babun:`, и поставленный раньше был бы стёрт. Дальше
    // токен меняется, экран перерисовывается и читает готовый ответ: гейта
    // человек не видит вовсе, а ждёт только данные, и то под скелетом.
    if (knownOnboarded) markTenantOnboarded(tenantId);

    const { data: activated, error: activateError } = await supabase.rpc(
      "activate_tenant",
      { p_tenant_id: tenantId },
    );
    if (activateError) {
      throw new Error(
        /not a member|membership/i.test(activateError.message)
          ? "Доступ к этой компании не найден."
          : activateError.message,
      );
    }

    const { data: refreshed, error: refreshError } =
      await supabase.auth.refreshSession();
    if (refreshError || !refreshed.session) {
      throw new Error(
        "Не удалось обновить вход. Проверьте интернет и повторите.",
      );
    }

    const activeTenant = (
      refreshed.session.user.app_metadata as { tenant_id?: unknown }
    ).tenant_id;
    if (activeTenant !== tenantId) {
      throw new Error("Сессия не переключилась на выбранную компанию.");
    }

    // ВТОРАЯ ЧИСТКА — С СОХРАНЕНИЕМ ПОДПИСЧИКОВ. Она идёт посреди живой
    // сессии, и снести запросы здесь значит заморозить смонтированные экраны
    // на «загрузке» навсегда: ответ придёт, а сказать о нём будет некому.
    // Почему так — в `lib/auth-clear.ts` над `wipeFastStores`.
    await wipeTenantScopedData({ keepSubscribers: true });

    // ШТАМП СТАВИТСЯ ПОСЛЕ ЧИСТКИ, И ЭТО НЕ ПРИДИРКА К ПОРЯДКУ: чистка сносит
    // ключи с префиксом `babun:`, а штамп — один из них. Поставленный раньше,
    // он был бы стёрт той же секундой, и гейт снова пошёл бы спрашивать сервер.
    //
    // Что именно он экономит: гейт держал экран «Открываем компанию» тридцать
    // секунд при пяти секундах самой транзакции — всё это время он выяснял
    // запросом то, что `activate_tenant` уже вернул. Ставим только по ФАКТУ с
    // сервера, а не по догадке.
    if (isOnboardedResult(activated)) markTenantOnboarded(tenantId);

    // ОТМЕНА ПЕРЕД ИНВАЛИДАЦИЕЙ, И ЭТО ГЛАВНАЯ СТРОКА ПО СКОРОСТИ. Запрос
    // гейта улетает ещё со старым токеном и повисает; `invalidateQueries` его
    // не будит — уже идущий запрос она не перезапускает, — а экран ждёт, пока
    // тот сам не отвалится. Замер: между двумя отрисовками гейта прошло
    // ШЕСТЬДЕСЯТ СЕКУНД, хотя ответ (штамп выше) лежал готовым с пятой.
    //
    // Отмена гасит зависший запрос, отрисовка происходит сразу, гейт читает
    // штамп и пускает дальше; инвалидация после неё оставляет всё протухшим,
    // и данные новой компании подтягиваются уже за открытым экраном.
    await queryClient.resetQueries();
    switched = true;
  } finally {
    if (!switched) {
      resumeRuntime();
      resumeOldBridge();
    }
  }
}
