import type { Appointment } from "@babun/shared/local/appointments";
import type { Client } from "@babun/shared/local/clients";
import { formatDateKey } from "@babun/shared/common/utils/date-utils";
import { addressedAs, firstName } from "@/features/clients/sms-name";
import { smsVars, type SmsVars } from "./sms-compose";

// ШАБЛОН SMS ИЗ КАРТОЧКИ КЛИЕНТА (STORY-089, волна 1).
//
// У карточки нет «своей» записи, но у клиента обычно есть БЛИЖАЙШАЯ — та,
// о которой ему и пишут «ждём вас в четверг». Поэтому поля записи в шаблоне
// берутся из ближайшей будущей работы; нет её — шаблоны с датой просто не
// предлагаются (`fillTemplate`). Долг и цена — только тому, кому деньги
// клиента открыты.

type AppointmentLike = Pick<
  Appointment,
  "date" | "time_start" | "status" | "kind" | "team_id" | "address" | "services" | "total_amount"
>;

/** Ближайшая запланированная работа клиента, начиная с сегодняшнего дня. */
export function nextScheduledWork<T extends AppointmentLike>(
  appointments: readonly T[],
  today: string,
): T | null {
  let best: T | null = null;
  for (const a of appointments) {
    if (a.kind !== "work" || a.status !== "scheduled" || a.date < today) continue;
    if (!best || a.date < best.date || (a.date === best.date && a.time_start < best.time_start)) {
      best = a;
    }
  }
  return best;
}

export function clientSmsVars(input: {
  client: Pick<Client, "full_name" | "sms_name">;
  appointments: readonly AppointmentLike[];
  teams: readonly { id: string; name: string }[];
  company: string | null;
  /** Долг клиента; `null` — деньги клиента человеку закрыты. */
  debt: number | null;
  /** Цена ближайшей записи видна только вместе с деньгами клиента. */
  showMoney: boolean;
  /** «Сегодня» — для тестов; по умолчанию дата телефона. */
  today?: string;
}): SmsVars {
  const next = nextScheduledWork(input.appointments, input.today ?? formatDateKey(new Date()));
  return smsVars({
    name: addressedAs(input.client, firstName(input.client)),
    company: input.company,
    debt: input.debt,
    date: next?.date ?? null,
    time: next?.time_start ?? null,
    calendar: next?.team_id ? (input.teams.find((t) => t.id === next.team_id)?.name ?? null) : null,
    services: next?.services.map((line) => line.serviceName) ?? [],
    address: next?.address ?? null,
    total: next && input.showMoney ? next.total_amount : null,
  });
}
