import type { Appointment } from "@babun/shared/local/appointments";

// ПОСЛЕДНЯЯ ЗАПИСЬ КЛИЕНТА — ЛИЦО БЛОКА «ИСТОРИЯ»: в истории
// высвечивается последняя запись, тап — страница со всеми записями.
//
// Последняя — самая поздняя по дате и времени, будущая тоже: записан на
// субботу — это и есть свежий факт о клиенте. Отменённая лицом блока не
// становится, пока есть живые; если живых нет — показываем последнюю
// отменённую, а не пустоту. События (не работа) в историю клиента не входят.

/** Последняя запись клиента; `null` — записей нет. */
export function lastClientRecord(appointments: readonly Appointment[]): Appointment | null {
  const work = appointments.filter((a) => !a.kind || a.kind === "work");
  const key = (a: Appointment) => `${a.date}T${a.time_start ?? ""}`;
  const latest = (list: readonly Appointment[]) =>
    list.reduce<Appointment | null>((best, a) => (best === null || key(a) > key(best) ? a : best), null);
  return latest(work.filter((a) => a.status !== "cancelled")) ?? latest(work);
}
