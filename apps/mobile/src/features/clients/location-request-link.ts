// ССЫЛКА КЛИЕНТУ «ОТМЕТЬТЕ АДРЕС» — чистая часть (STORY-077).
//
// Владелец 2026-09-07: «менеджеру сложно постоянно запрашивать локацию у
// клиента — легче скопировать ссылку нашего ПО, клиент сам заходит, выбирает
// чёткий адрес и вносит данные, куда приехать мастеру». Здесь то, что можно
// проверить без сети: вид ссылки, текст «Поделиться», состояние заявки и
// какие заявки показывать в карточке. Хуки — в location-requests.ts.

/** Веб-версия живёт на babun.app (master → Vercel); только https открывается
 *  у клиента без приложения — схема babun:// здесь не годится. */
export const LOCATION_LINK_ORIGIN = "https://babun.app";

/** Токен выписывает сервер: 24 случайных байта → 32 символа base64url. */
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;

export function isLocationRequestToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_RE.test(value);
}

export function locationRequestLink(token: string): string {
  if (!isLocationRequestToken(token)) throw new Error("Некорректная ссылка");
  return `${LOCATION_LINK_ORIGIN}/l/${token}`;
}

/** Фраза для «Поделиться» — БЕЗ ссылки: её платформа добавляет сама
 *  (см. shareLink), в браузере отдельным полем, на нативе строкой ниже —
 *  мессенджеры делают превью ссылке, которая стоит в конце. */
export function locationRequestShareText(
  businessName: string | null | undefined,
): string {
  const who = (businessName ?? "").trim();
  return `${who ? `${who}: ` : ""}отметьте, пожалуйста, адрес, куда приехать мастеру — это минута.`;
}

export interface LocationRequest {
  id: string;
  client_id: string;
  token: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  location_id: string | null;
}

export type LocationRequestState = "pending" | "used" | "expired";

export function locationRequestState(
  r: Pick<LocationRequest, "used_at" | "expires_at">,
  now: number = Date.now(),
): LocationRequestState {
  if (r.used_at) return "used";
  if (new Date(r.expires_at).getTime() < now) return "expired";
  return "pending";
}

/** Сколько устаревшая ссылка ещё видна в карточке: диспетчер должен узнать,
 *  что клиент не ответил, но вечная строка «устарела» — мусор. */
const EXPIRED_VISIBLE_MS = 30 * 24 * 60 * 60 * 1000;

/** Что показать в блоке объектов: ОДНА строка — новейшая живая ссылка, а без
 *  живой — новейшая устаревшая не старше месяца. Использованные ссылки уже
 *  стали объектами и строкой не показываются. */
export function visibleLocationRequests(
  requests: readonly LocationRequest[],
  now: number = Date.now(),
): LocationRequest[] {
  const sorted = [...requests].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  const pending = sorted.find((r) => locationRequestState(r, now) === "pending");
  if (pending) return [pending];
  const expired = sorted.find(
    (r) =>
      locationRequestState(r, now) === "expired" &&
      now - new Date(r.expires_at).getTime() < EXPIRED_VISIBLE_MS,
  );
  return expired ? [expired] : [];
}

/** «7 сент.» — дата в строке «Ждём адрес». */
export function shortDate(iso: string, locale = "ru-RU"): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" })
      .format(date)
      .replace(/\.$/, "");
  } catch {
    return `${date.getDate()}.${String(date.getMonth() + 1).padStart(2, "0")}`;
  }
}

/** Подпись строки в карточке: что случилось и когда. */
export function locationRequestCaption(
  r: LocationRequest,
  now: number = Date.now(),
): { title: string; caption: string } {
  const state = locationRequestState(r, now);
  const sent = shortDate(r.created_at);
  if (state === "expired") {
    return {
      title: "Ссылка устарела",
      caption: sent ? `Клиент не ответил · отправлена ${sent}` : "Клиент не ответил",
    };
  }
  const until = shortDate(r.expires_at);
  return {
    title: "Ждём адрес от клиента",
    caption: [sent ? `Ссылка отправлена ${sent}` : "Ссылка отправлена", until ? `до ${until}` : ""]
      .filter(Boolean)
      .join(" · "),
  };
}
