/** Подпись под пальцем — строками, которые не рвутся: «Сб 31» над «15:30»,
 *  «15:30–» над «17:00». Одной строкой в узкой колонке Недели (~45pt) она
 *  переносилась посреди времени: «15:» / «30». */
export function liveTimeLines(label: string): string[] {
  const dash = label.indexOf("–");
  if (dash > 0) return [label.slice(0, dash + 1), label.slice(dash + 1)];
  const space = label.lastIndexOf(" ");
  return space > 0 ? [label.slice(0, space), label.slice(space + 1)] : [label];
}
