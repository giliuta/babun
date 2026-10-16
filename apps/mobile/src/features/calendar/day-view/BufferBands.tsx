import { useThemeColors } from "@/theme/colors";
import type { PlacedAppt } from "@/features/calendar/layout";
import { MinuteBand } from "./MinuteBand";

// Buffer bands — «забронировано под дорогу/уборку» after each live
// appointment; rendered before the blocks so colour cards sit on top
// (cancelled skipped). Placements already exclude all-day events — те
// живут чипами в полосе НАД сеткой — and carry the parsed endMin.
export function BufferBands({
  placements,
  bufferMinutes,
  winStartMin,
  winEndMin,
}: {
  placements: PlacedAppt[];
  bufferMinutes: number;
  winStartMin: number;
  winEndMin: number;
}) {
  const t = useThemeColors();
  return (
    <>
      {bufferMinutes > 0
        ? placements.map((p) => {
            if (p.apt.status === "cancelled") return null;
            const bandStart = Math.max(p.endMin, winStartMin);
            const bandEnd = Math.min(p.endMin + bufferMinutes, winEndMin);
            if (bandEnd <= bandStart) return null;
            return (
              <MinuteBand
                key={`buffer-${p.apt.id}`}
                fromMin={bandStart}
                toMin={bandEnd}
                winStartMin={winStartMin}
                winEndMin={winEndMin}
                color={t.fill}
              />
            );
          })
        : null}
    </>
  );
}
