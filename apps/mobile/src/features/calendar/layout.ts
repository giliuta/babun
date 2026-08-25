import type { Appointment } from "@babun/shared/local/appointments";

export type PlacedAppt = {
  apt: Appointment;
  startMin: number;
  endMin: number;
  colIndex: number;
  colCount: number;
};

export const toMin = (hm: string): number => {
  const [h, m] = (hm ?? "0:0").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

// Assign each appointment a column so mutually-overlapping ones sit
// side-by-side instead of stacking full-width. Standard interval-graph
// approach: split into clusters of transitively-overlapping events, then
// greedily pack each cluster into the fewest columns; every block in a
// cluster shares that cluster's column count (equal widths, like the web grid).
export function layoutDay(appts: Appointment[]): PlacedAppt[] {
  const items = appts
    .map((apt) => {
      const startMin = toMin(apt.time_start);
      const endMin = Math.max(toMin(apt.time_end), startMin + 15);
      return { apt, startMin, endMin };
    })
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  const out: PlacedAppt[] = [];
  let cluster: typeof items = [];
  let clusterEnd = -1;

  const flush = () => {
    if (cluster.length === 0) return;
    const colEnds: number[] = []; // running end-time per column
    const cols: number[] = [];
    for (const it of cluster) {
      let col = colEnds.findIndex((e) => e <= it.startMin);
      if (col === -1) {
        col = colEnds.length;
        colEnds.push(it.endMin);
      } else {
        colEnds[col] = it.endMin;
      }
      cols.push(col);
    }
    const colCount = colEnds.length;
    cluster.forEach((it, i) => {
      out.push({
        apt: it.apt,
        startMin: it.startMin,
        endMin: it.endMin,
        colIndex: cols[i],
        colCount,
      });
    });
    cluster = [];
    clusterEnd = -1;
  };

  for (const it of items) {
    if (cluster.length > 0 && it.startMin >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.endMin);
  }
  flush();
  return out;
}
