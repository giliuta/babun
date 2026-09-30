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
