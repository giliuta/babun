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
  if (isOwnWrite(change.id, now)) return true;
  if (!change.updatedAt) return false;
  for (const row of cached) {
    if (row.id === change.id && row.updated_at && sameInstant(row.updated_at, change.updatedAt)) {
      return true;
    }
  }
  return false;
}
