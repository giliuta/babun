// Brief 1 #20 — Pure helper to detect overlapping appointments.
//
// Extracted from AppointmentSheet's inline useMemo so the same rules
// run on drag-drop, batch import, conflict-check UI, and tests.
//
// Semantics — half-open interval, per (date, team_id) bucket:
//   · An appointment is considered to overlap `candidate` when both
//     are on the same date AND same team AND their [start, end)
//     ranges intersect.
//   · Cancelled rows never count (they're ghosts).
//   · Personal events / kind="event" never collide with work
//     appointments and vice versa.

interface OverlapCandidate {
  id?: string;
  date: string;
  time_start: string;
  time_end: string;
  team_id?: string | null;
  kind?: "work" | "event" | "personal";
}

interface OverlapExisting extends OverlapCandidate {
  id: string;
  status?: string;
}

export function findOverlap(
  candidate: OverlapCandidate,
  existing: readonly OverlapExisting[],
): OverlapExisting | null {
  if (!candidate.team_id) return null;
  if (candidate.kind === "event" || candidate.kind === "personal") return null;
  if (
    !candidate.time_start ||
    !candidate.time_end ||
    candidate.time_start >= candidate.time_end
  ) {
    return null;
  }
  for (const other of existing) {
    if (other.id === candidate.id) continue;
    if (other.status === "cancelled") continue;
    if (other.date !== candidate.date) continue;
    if (other.team_id !== candidate.team_id) continue;
    if (other.kind === "event" || other.kind === "personal") continue;
    if (
      candidate.time_start < other.time_end &&
      other.time_start < candidate.time_end
    ) {
      return other;
    }
  }
  return null;
}

function toMinutes(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Соседняя запись, до которой не осталось буфера — зазора на дорогу и
 * уборку (calendar_settings.buffer_minutes, перекрывается teams.buffer_minutes).
 *
 * Раньше буфер был чистой декорацией: сетка рисовала серую полосу, а
 * поставить визит впритык ничто не мешало — доктайп обещал «новые записи не
 * ставятся в буфер», и это было неправдой. Теперь буфер предупреждает — но
 * НЕ блокирует: то же правило, что у пересечений и нерабочих часов
 * (диспетчер иногда ставит впритык сознательно).
 *
 * Пересечение здесь пропускается: это более сильный сигнал, и о нём говорит
 * findOverlap — два предупреждения об одной беде были бы шумом.
 */
export function findBufferClash(
  candidate: OverlapCandidate,
  existing: readonly OverlapExisting[],
  bufferMinutes: number,
): OverlapExisting | null {
  if (bufferMinutes <= 0) return null;
  if (!candidate.team_id) return null;
  if (candidate.kind === "event" || candidate.kind === "personal") return null;
  if (
    !candidate.time_start ||
    !candidate.time_end ||
    candidate.time_start >= candidate.time_end
  ) {
    return null;
  }
  const start = toMinutes(candidate.time_start);
  const end = toMinutes(candidate.time_end);
  for (const other of existing) {
    if (other.id === candidate.id) continue;
    if (other.status === "cancelled") continue;
    if (other.date !== candidate.date) continue;
    if (other.team_id !== candidate.team_id) continue;
    if (other.kind === "event" || other.kind === "personal") continue;
    if (
      candidate.time_start < other.time_end &&
      other.time_start < candidate.time_end
    ) {
      continue; // накладка — о ней скажет findOverlap
    }
    const otherStart = toMinutes(other.time_start);
    const otherEnd = toMinutes(other.time_end);
    // Буфер нужен ПОСЛЕ визита, поэтому меряем зазор с обеих сторон: и когда
    // новая запись садится следом за чужой, и когда чужая садится следом за
    // новой.
    const gap = start >= otherEnd ? start - otherEnd : otherStart - end;
    if (gap < bufferMinutes) return other;
  }
  return null;
}
