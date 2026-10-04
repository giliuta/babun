import type { RealtimeChange } from "@babun/shared/sync";

// ЭХО СВОЕЙ ПРАВКИ (владелец 2026-09-30: перенос и оплата «подлагивают»).
// Realtime приносит телефону и ЕГО ЖЕ правку. Мост на каждое событие
// перечитывал весь список записей: SQLite целиком, потом сервер постранично,
// потом полная перезапись кэша, — и так после каждого переноса и каждой
// оплаты. Хуже того, эхо оплаты часто приходит раньше ответа RPC: перечитка
// брала из SQLite строку ДО оплаты, и плитка «оплачено» мигала обратно.
//
// Правило: событие по записи, которую этот телефон сейчас меняет (или только
// что поменял), или по записи, чья версия (`updated_at`) уже лежит в кэше, —
// не новость. Чужая правка (другой телефон) приходит с другой версией и
// перечитывается, как раньше; удаление — всегда.

const ownUntil = new Map<string, number>();

/** Правка записи этим телефоном: пока она летит — `inFlightMs`, после
 *  ответа — ещё `settleMs` на запоздавшее эхо. */
export function markOwnWrite(id: string, ms: number): void {
  ownUntil.set(id, Date.now() + ms);
}

export const OWN_WRITE_IN_FLIGHT_MS = 30_000;
export const OWN_WRITE_SETTLE_MS = 3_000;

export function isOwnWrite(id: string, now: number = Date.now()): boolean {
  const until = ownUntil.get(id);
  if (until == null) return false;
  if (until <= now) {
    ownUntil.delete(id);
    return false;
  }
  return true;
}

/** «2026-09-30 08:55:08.016962+00» (Postgres) → ISO, который разберёт и
 *  Hermes; микросекунды отрезаются до миллисекунд. */
const toMs = (v: string): number =>
  Date.parse(
    v
      .trim()
      .replace(" ", "T")
      .replace(/(\.\d{3})\d+/, "$1")
      .replace(/([+-]\d{2})$/, "$1:00"),
  );

const sameInstant = (a: string, b: string): boolean => {
  const x = toMs(a);
  const y = toMs(b);
  return Number.isFinite(x) && x === y;
};

/**
 * Событие realtime — эхо того, что телефон уже знает? `cached` — строки
 * списков записей, что лежат в кэше экрана.
 */
export function isKnownChange(
  change: RealtimeChange | undefined,
  cached: Iterable<{ id: string; updated_at?: string | null }>,
  now: number = Date.now(),
): boolean {
  if (!change || !change.id) return false;
  if (change.event === "DELETE") return false;
  if (isOwnWrite(change.id, now)) {
    // Событие проглочено окном своей правки — но оно может быть и ЧУЖИМ
    // (другой телефон правил ту же запись в эти секунды). Помним самую
    // свежую версию: когда окно закроется, мост сверит её с кэшем.
    if (change.updatedAt) noteSwallowed(change.id, change.updatedAt);
    return true;
  }
  if (!change.updatedAt) return false;
  for (const row of cached) {
    if (row.id === change.id && row.updated_at && sameInstant(row.updated_at, change.updatedAt)) {
      return true;
    }
  }
  return false;
}

// ПРОГЛОЧЕННОЕ ОКНОМ СВОЕЙ ПРАВКИ (аудит параллельных правок 03.10). Окно
// глушит ВСЕ события по записи, пока своя правка летит и ещё три секунды
// после: так своё эхо не перечитывает календарь. Но в эти же секунды запись
// мог поменять другой телефон — его событие тоже проглатывалось, а второго
// не будет: перенос или оплата с телефона Б не появлялись, пока что-то
// другое не перечитает список.
const swallowed = new Map<string, string>();

function noteSwallowed(id: string, updatedAt: string): void {
  const known = swallowed.get(id);
  if (!known || toMs(updatedAt) > toMs(known)) swallowed.set(id, updatedAt);
}

/** Когда кончается окно своей правки записи (`null` — окна нет). */
export function ownWindowEndsAt(id: string): number | null {
  return ownUntil.get(id) ?? null;
}

/** Окно закрылось: было ли среди проглоченных событие НОВЕЕ того, что лежит
 *  в кэше, — то есть чужая правка, которую экран так и не показал. Ответ
 *  один раз: память о записи снимается. */
export function takeMissedChange(id: string, cachedUpdatedAt: string | null | undefined): boolean {
  const seen = swallowed.get(id);
  swallowed.delete(id);
  if (!seen) return false;
  if (!cachedUpdatedAt) return true;
  const a = toMs(seen);
  const b = toMs(cachedUpdatedAt);
  return Number.isFinite(a) && (!Number.isFinite(b) || a > b);
}
