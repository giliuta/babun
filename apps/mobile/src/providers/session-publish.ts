import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

// ОБНОВЛЁННЫЙ ТОКЕН ТОГО ЖЕ ЧЕЛОВЕКА ДЕРЕВО НЕ ПЕРЕРИСОВЫВАЕТ.
//
// `TOKEN_REFRESHED` приносит НОВЫЙ объект сессии, и `setSession` с ним
// перерисовывал всё под `SessionProvider` — каждый экран с `useSession`. Экраны
// берут из сессии только человека (id, почта, метаданные); сам токен читает
// клиент supabase из своего хранилища, а не из контекста. Догон claim'а после
// перехода делает `refreshSession` — то есть лишняя волна рендеров приходилась
// ровно на секунды после тапа.
//
// Публикуется всё, где меняется то, что экраны читают: другой человек, другая
// почта, другие `app_metadata` (компания в токене — запасной путь
// `useTenantId`) или `user_metadata`.

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function shouldPublishSession(
  event: AuthChangeEvent,
  prev: Session | null,
  next: Session | null,
): boolean {
  if (event !== "TOKEN_REFRESHED") return true;
  if (!prev || !next) return true;
  return !(
    prev.user.id === next.user.id &&
    prev.user.email === next.user.email &&
    sameJson(prev.user.app_metadata, next.user.app_metadata) &&
    sameJson(prev.user.user_metadata, next.user.user_metadata)
  );
}

// ВЫШЕЛ — ПОВТОРЫ ЕГО ЗАПРОСОВ ГАСНУТ.
//
// Часть запросов вошедшего (скрытые и порядок календарей, настройки
// уведомлений, реестр прав) висит над экраном входа и не размонтируется на
// выходе. Чистка на выходе будит их, пока страницы человека ещё на экране, —
// заслонка (`anon-guard.ts`) отбивает их как обрыв, и react-query ставит
// повтор через секунду. Повтор идёт по таймеру и на `enabled` не смотрит: к
// его сроку на экране уже вход, заслонка молчит, и запрос уходит анонимом —
// 401 от сервера. Поэтому на переходе «был человек → никого» все запросы
// гасятся вместе с их повторами.
export function signedOutNow(prev: string | null, next: string | null): boolean {
  return prev !== null && next === null;
}
