type WallClockParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const formatterByTimeZone = new Map<string, Intl.DateTimeFormat>();
export const DEFAULT_TENANT_TIME_ZONE = "Europe/Nicosia";

function wallClockFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterByTimeZone.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-CA-u-hc-h23", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  // Some Intl implementations defer invalid-IANA-zone errors until format.
  formatter.formatToParts(new Date(0));
  formatterByTimeZone.set(timeZone, formatter);
  return formatter;
}

function wallClockPartsAt(epochMs: number, timeZone: string): WallClockParts {
  const parts = wallClockFormatter(timeZone).formatToParts(new Date(epochMs));
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = Number(parts.find((part) => part.type === type)?.value);
    if (!Number.isFinite(value)) throw new RangeError("invalid timezone parts");
    return value;
  };
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour") % 24,
    minute: read("minute"),
    second: read("second"),
  };
}

function wallClockEpoch(parts: WallClockParts): number {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
}

function parseWallClock(date: string, time: string): WallClockParts | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) return null;
  const parts: WallClockParts = {
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
    second: 0,
  };
  const proof = new Date(wallClockEpoch(parts));
  return proof.getUTCFullYear() === parts.year &&
    proof.getUTCMonth() + 1 === parts.month &&
    proof.getUTCDate() === parts.day &&
    proof.getUTCHours() === parts.hour &&
    proof.getUTCMinutes() === parts.minute
    ? parts
    : null;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    wallClockFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Missing legacy settings intentionally inherit the product default. A
 * present-but-invalid zone returns null so the sweep skips that tenant rather
 * than sending at an invented time. */
export function resolveTenantTimeZone(value: unknown): string | null {
  const candidate =
    typeof value === "string" && value.trim()
      ? value.trim()
      : DEFAULT_TENANT_TIME_ZONE;
  return isValidTimeZone(candidate) ? candidate : null;
}

/** Convert a tenant/team wall time into an instant. Handles DST overlap/gaps
 * and zones with half/quarter-hour offsets; returns null for invalid input. */
export function tenantLocalToUtc(
  date: string,
  time: string,
  timeZone: string,
): Date | null {
  const desired = parseWallClock(date, time);
  if (!desired) return null;
  try {
    const desiredEpoch = wallClockEpoch(desired);
    const offsets = new Set<number>();
    for (let hours = -48; hours <= 48; hours += 6) {
      const sampledEpoch = desiredEpoch + hours * 60 * 60_000;
      offsets.add(
        wallClockEpoch(wallClockPartsAt(sampledEpoch, timeZone)) - sampledEpoch,
      );
    }

    const exact: number[] = [];
    const shiftedForward: { epoch: number; wallDelta: number }[] = [];
    for (const offset of offsets) {
      const candidateEpoch = desiredEpoch - offset;
      const renderedEpoch = wallClockEpoch(
        wallClockPartsAt(candidateEpoch, timeZone),
      );
      const wallDelta = renderedEpoch - desiredEpoch;
      if (wallDelta === 0) exact.push(candidateEpoch);
      else if (wallDelta > 0) {
        shiftedForward.push({ epoch: candidateEpoch, wallDelta });
      }
    }
    if (exact.length > 0) return new Date(Math.min(...exact));
    if (shiftedForward.length > 0) {
      shiftedForward.sort(
        (a, b) => a.wallDelta - b.wallDelta || a.epoch - b.epoch,
      );
      return new Date(shiftedForward[0].epoch);
    }
    return null;
  } catch {
    return null;
  }
}

export function dateKeyInTimeZone(date: Date, timeZone: string): string {
  const parts = wallClockFormatter(timeZone).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}
