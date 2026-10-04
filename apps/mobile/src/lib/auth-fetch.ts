// ВХОД НЕ ДОЛЖЕН ТЕРЯТЬСЯ ИЗ-ЗА ЛЕЖАЩЕГО СЕРВЕРА (01.10).
//
// Ночью база не отвечала четыре часа. Когда её подняли, владельца и
// сотрудника выкинуло из аккаунта на экран входа. Лог сервера показал, как:
//
//   1. Наш потолок ожидания (12 с, `supabase.ts`) обрывал и обновление
//      токена. Библиотека входа считает обрыв временной бедой и шлёт
//      обновление заново — а оборванный запрос остаётся в очереди сервера.
//   2. Сервер поднялся и разобрал очередь разом: одно обновление прошло,
//      остальные с тем же ключом получили 409 «слишком много одновременных
//      обновлений».
//   3. 409 библиотека считает окончательным отказом, и раз токен доступа к
//      утру истёк — стирает сессию.
//
// Поэтому: обновление токена потолка не имеет (одно на клиент, библиотека
// сама держит его единственным), а 409 на обновлении отдаётся ей как 503 —
// временный отказ, который она повторяет. Повтор в пределах окна повторного
// использования ключа (10 с) получает уже выданную сессию; позже — честный
// 400, и тогда выход заслужен.

const REFRESH_PATH = "/auth/v1/token";

function partsOf(url: string): { path: string; grant: string | null } {
  try {
    const parsed = new URL(url);
    return { path: parsed.pathname, grant: parsed.searchParams.get("grant_type") };
  } catch {
    return { path: "", grant: null };
  }
}

/** Запрос к службе входа — ему наш потолок ожидания не ставится. */
export function isAuthRequest(url: string): boolean {
  return partsOf(url).path.startsWith("/auth/v1/");
}

/** Отказ «обновлений слишком много» — временный: отдать его как 503. */
export function isRefreshConflict(url: string, status: number): boolean {
  if (status !== 409) return false;
  const { path, grant } = partsOf(url);
  return path === REFRESH_PATH && grant === "refresh_token";
}

/** Ответ службы входа, каким его увидит библиотека. */
export async function retryableAuthResponse(url: string, response: Response): Promise<Response> {
  if (!isRefreshConflict(url, response.status)) return response;
  const body = await response.text();
  return new Response(body, {
    status: 503,
    statusText: "Service Unavailable",
    headers: response.headers,
  });
}
