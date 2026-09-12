import { supabase } from "@/lib/supabase";
import { queryClient } from "@/lib/query-client";
import { wipeTenantScopedData } from "@/lib/auth-clear";
import { setActiveTenantId } from "@/lib/active-tenant";
import { markTenantOnboarded } from "@/lib/tenant";
import { currentRoleQueryKey } from "./tenant";
import type { UserRole } from "./role-policy";

// ПЕРЕХОД В ДРУГУЮ КОМПАНИЮ — ОДНА ТРАНЗАКЦИЯ НА ВЕСЬ ПРОДУКТ.
//
// Человек живёт в нескольких контурах: свой личный календарь и те компании,
// куда его добавили. Переключение между ними — не «поменять переменную»: на
// активном контуре завязаны ключи react-query, права на экранах и мост
// синхронизации.
//
// ЧЕГО ЗДЕСЬ БОЛЬШЕ НЕТ И ПОЧЕМУ.
//
// Раньше переход стоил ДВУХ поездок на сервер: `activate_tenant` переставлял
// компанию в токене, `refreshSession` забирал новый токен. Замер на боевой —
// 2.3 с и 2.5 с, и убрать их было нельзя: компания жила в JWT, а JWT иначе не
// меняется. Пять секунд ожидания на каждое касание чипа.
//
// Теперь компанию называет КЛИЕНТ заголовком запроса, а сервер подтверждает её
// членством (`current_tenant_id()`, миграция
// `active_tenant_from_verified_header`). Поэтому переход — это ДВЕ СТРОКИ без
// сети: поставить компанию и протухнуть запросы. Ноль поездок, ноль ожидания.
//
// `activate_tenant` НЕ СНЁСЕН, но уехал в фон: realtime, storage и
// edge-функции ходят в базу мимо PostgREST и заголовка не видят — им нужен
// прежний claim в токене. Он догоняет за пару секунд, и ни один экран его не
// ждёт.
//
// И ЧИСТКИ ЗДЕСЬ БОЛЬШЕ НЕ ДВЕ, А ОДНА, И ОНА НЕ ТРОГАЕТ SQLite. Строки в кэше
// разложены по компаниям, а очередь несохранённых операций защищена сверкой в
// `sync/replayer.ts` — снос не давал безопасности, зато уничтожал набранную
// работу и заставлял скачивать всё заново при возврате. Разбор — над
// `cacheClearAll` в `lib/auth-clear.ts`.

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

/** Догоняющая половина перехода: claim в токене для тех поверхностей, которые
 *  заголовка не видят. Экран её НЕ ЖДЁТ — отсюда и `void` у вызова.
 *
 *  Провал не откатывает переход: заголовок уже работает, данные компании уже
 *  на экране. Пострадают только realtime (сообщение с другого устройства
 *  приедет позже, по обычному refetch) и загрузка файлов — до следующей
 *  успешной попытки. Молчать об этом в консоли нельзя, врать человеку окном
 *  «не удалось переключиться» — тем более: он уже переключился. */
async function catchUpTokenClaim(tenantId: string): Promise<void> {
  const { data: activated, error } = await supabase.rpc("activate_tenant", {
    p_tenant_id: tenantId,
  });
  if (error) return;
  if (isOnboardedResult(activated)) markTenantOnboarded(tenantId);
  await supabase.auth.refreshSession();
}

export interface SwitchTenantOptions {
  /** Факт с сервера: компания прошла онбординг. `list_my_calendars` отдаёт его
   *  вместе с лентой, поэтому в момент тапа ответ уже лежит — и гейт
   *  «Открываем компанию» не показывается вовсе. */
  onboarded?: boolean;
  /** Роль В ЭТОЙ компании, тоже из ленты календарей. Без неё каждый экран с
   *  правами (деньги, кабинет, настройки) показывал бы крутилку, пока
   *  `current_user_role` летает на сервер: роль приезжает ОТВЕТОМ, а экран
   *  уже смонтирован. */
  role?: UserRole;
}

/** Меняет активную компанию на ЭТОМ устройстве.
 *
 *  Возвращается синхронно быстро: внутри нет ни одной поездки на сервер,
 *  которую ждёт экран. */
export async function switchTenant(
  tenantId: string,
  options: SwitchTenantOptions | boolean = {},
): Promise<void> {
  // Приём приглашения зовёт эту же функцию вторым аргументом-флагом — форма
  // осталась ради него, чтобы не заводить второй способ менять компанию.
  const opts: SwitchTenantOptions =
    typeof options === "boolean" ? { onboarded: options } : options;

  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) throw new Error("Войдите в аккаунт, чтобы сменить компанию.");

  // ШТАМП ВПЕРЁД, ЕСЛИ ФАКТ УЖЕ ИЗВЕСТЕН. Ставится ДО чистки — она сносит
  // ключи с префиксом `babun:`, поэтому порядок здесь не придирка. Дальше
  // экран перерисовывается и читает готовый ответ: гейта человек не видит.
  if (opts.onboarded) markTenantOnboarded(tenantId);

  // САМ ПЕРЕХОД. Одна строка, ноль сети: следующий же запрос уходит с новым
  // заголовком, и сервер отвечает данными новой компании.
  setActiveTenantId(userId, tenantId);

  // Чистка с сохранением подписчиков и местного кэша: запросы прежней компании
  // протухают, смонтированные экраны об этом УЗНАЮТ (снос оставил бы их
  // замороженными на «загрузке» навсегда), а скачанное прежде остаётся лежать
  // и делает возврат назад мгновенным.
  await wipeTenantScopedData({ keepSubscribers: true, keepLocalCache: true });

  // РОЛЬ КЛАДЁТСЯ ПОСЛЕ ЧИСТКИ, ИНАЧЕ ЕЁ ЖЕ И СМОЕТ. С ней границы прав
  // отвечают в первом кадре; без неё `RoleCapabilityBoundary` честно покажет
  // крутилку, пока роль летит с сервера, — то есть ровно то ожидание, которое
  // мы отсюда и убираем.
  if (opts.role) {
    queryClient.setQueryData(currentRoleQueryKey(tenantId), opts.role);
  }

  // ОТМЕНА ПЕРЕД ИНВАЛИДАЦИЕЙ. Запрос, улетевший со старым заголовком, висит;
  // `invalidateQueries` его не будит — уже идущий запрос она не перезапускает,
  // — и экран ждёт, пока тот сам не отвалится. Сброс гасит зависшее и
  // оставляет всё протухшим: данные новой компании подтягиваются уже за
  // открытым экраном.
  await queryClient.resetQueries();

  // Догоняющая половина — в фоне, экран её не ждёт.
  void catchUpTokenClaim(tenantId);
}
