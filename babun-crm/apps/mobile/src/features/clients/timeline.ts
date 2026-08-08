import type { Appointment } from "@babun/shared/local/appointments";
import type { Client } from "@babun/shared/local/clients";

// ЛЕНТА КЛИЕНТА — одна история вместо трёх разделов.
//
// Раньше «что было» лежало в трёх местах: визиты — на отдельной странице,
// заметки — блоком на карточке, документы — ещё одной страницей. Перед
// звонком диспетчер собирал картину сам, переключая экраны, и в итоге не
// собирал: «звонила вчера, просила перенести» и «приезжали 30 мая на €120» —
// это одна нить, разорванная надвое.
//
// Лента складывает события по дате, свежие сверху. Источники разные, тип
// один — экран рисует их одинаковыми строками.

export type TimelineKind = "visit" | "note" | "reminder";

export interface TimelineEvent {
  id: string;
  kind: TimelineKind;
  /** YYYY-MM-DD — по нему сортируем и группируем. */
  date: string;
  /** «10:00» у визитов; у заметок пусто. */
  time?: string;
  title: string;
  /** Вторая строка: услуги, сумма, текст заметки. */
  subtitle?: string;
  /** Деньги визита (для правого края строки). */
  amount?: number;
  /** Долг по этому визиту — печатается вместо суммы. */
  debt?: number;
  /** Статус визита — «Отменено» гасит строку. */
  cancelled?: boolean;
  /** id записи — по нему строка открывает саму запись. */
  apptId?: string;
}

export function buildTimeline(
  /** null, пока карточка ещё грузится — визиты уже показываем. */
  client: Client | null | undefined,
  appts: readonly Appointment[],
  serviceName: (id: string) => string | null,
): TimelineEvent[] {
  const out: TimelineEvent[] = [];

  for (const a of appts) {
    if (a.kind && a.kind !== "work") continue;
    const names = (a.services ?? [])
      .map((s) => serviceName(s.serviceId))
      .filter((n): n is string => Boolean(n));
    const legacy = names.length
      ? []
      : (a.service_ids ?? [])
          .map((id) => serviceName(id))
          .filter((n): n is string => Boolean(n));
    const label = [...names, ...legacy].join(" · ");
    const total = a.total_amount ?? 0;
    const paid = a.paid_amount ?? 0;
    out.push({
      id: `visit-${a.id}`,
      apptId: a.id,
      kind: "visit",
      date: a.date,
      time: a.time_start || undefined,
      title: label || "Визит",
      subtitle: (a.comment ?? "").trim() || undefined,
      amount: total || undefined,
      debt:
        a.status !== "cancelled" && total > paid ? Math.round(total - paid) : 0,
      cancelled: a.status === "cancelled",
    });
  }

  for (const n of client?.notes ?? []) {
    out.push({
      id: `note-${n.id}`,
      kind: "note",
      date: (n.created_at ?? "").slice(0, 10),
      title: n.text,
    });
  }

  const imported = (client?.comment ?? "").trim();
  if (imported) {
    out.push({
      id: "note-imported",
      kind: "note",
      // Импортированная заметка без даты — самая старая запись истории.
      date: (client?.created_at ?? "").slice(0, 10),
      title: imported,
      subtitle: "из импорта",
    });
  }

  if (client?.reminder_at) {
    out.push({
      id: "reminder",
      kind: "reminder",
      date: client.reminder_at.slice(0, 10),
      title: "Напоминание о клиенте",
    });
  }

  // Свежие сверху; внутри дня визиты по времени, заметки следом.
  return out.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (b.time ?? "").localeCompare(a.time ?? "");
  });
}
