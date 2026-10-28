import type { Appointment } from "@babun/shared/local/appointments";
import type { Client } from "@babun/shared/local/clients";
import type { SmsTeamTemplate } from "@/features/sms/sms-team-templates";

// ПЕРЕНОС ПАЛЬЦЕМ ГОВОРИТ, ЧТО КЛИЕНТУ УЙДЁТ SMS. Шаблон команды «При
// переносе» сервер ставит в очередь сам (`appointments_sms_trigger`), и
// человек, сдвинувший блок по сетке, не знал, что клиенту уже пишут. Тост
// переноса называет это словами, а его «Отменить» успевает снять и перенос, и
// сообщение: перенос ждёт в очереди дольше, чем живёт тост.
//
// Правило — то же, что у сервера, насколько его видно с телефона: работа с
// клиентом, в плане, сдвинулись день или начало (растяжка за конец клиенту
// не пишет), визит после переноса впереди (о прошедшем сервер не пишет), сервис SMS включён, у команды есть имя отправителя и включённый
// шаблон «При переносе», у клиента есть телефон и он не просил не писать.

export interface RescheduleSmsInput {
  apt: Pick<Appointment, "kind" | "client_id" | "status" | "date" | "time_start">;
  teamId: string | null;
  date: string;
  timeStart: string;
  client: Pick<Client, "phone" | "phone_e164" | "sms_opt_out" | "blacklisted"> | null | undefined;
  serviceOn: boolean;
  senders: Record<string, string> | undefined;
  templates: readonly Pick<SmsTeamTemplate, "teamId" | "trigger" | "enabled">[];
  /** Сейчас по часам календаря, «YYYY-MM-DD HH:MM». */
  now: string;
}

export function rescheduleSmsGoes({
  apt,
  teamId,
  date,
  timeStart,
  client,
  serviceOn,
  senders,
  templates,
  now,
}: RescheduleSmsInput): boolean {
  if (apt.kind !== "work" || !apt.client_id || apt.status !== "scheduled") return false;
  if (apt.date === date && apt.time_start === timeStart) return false;
  if (`${date} ${timeStart.slice(0, 5)}` <= now) return false;
  if (!serviceOn || !teamId || !senders?.[teamId]?.trim()) return false;
  if (!client || client.sms_opt_out || client.blacklisted) return false;
  if (!(client.phone_e164 ?? "").trim() && !(client.phone ?? "").trim()) return false;
  return templates.some((t) => t.teamId === teamId && t.enabled && t.trigger === "rescheduled");
}

/** Сколько сообщение о переносе ждёт в очереди (`sms_enqueue`): пока оно не
 *  ушло, перенос обратно его снимает. */
export const RESCHEDULE_SMS_HOLD_MS = 60_000;

export interface KnownSlot {
  date: string;
  timeStart: string;
  at: number;
}

/** ВРЕМЯ, КОТОРОЕ КЛИЕНТ ЗНАЕТ, — как у сервера (`sms_messages.known_start`).
 *  Перенос ставит сообщение и запоминает прежнее время; перенос обратно на
 *  него, пока сообщение ждёт, сообщение снимает — тост не обещает SMS, которого
 *  не будет. Перенос дальше (A → B → C) оставляет одно сообщение. */
export function smsOnMoveWithMemory(
  known: Map<string, KnownSlot>,
  apt: { id: string; date: string; time_start: string },
  date: string,
  timeStart: string,
  goes: boolean,
  nowMs: number,
): boolean {
  const k = known.get(apt.id);
  const held = k != null && nowMs - k.at < RESCHEDULE_SMS_HOLD_MS;
  if (!held) known.delete(apt.id);
  if (held && k.date === date && k.timeStart === timeStart) {
    known.delete(apt.id);
    return false;
  }
  if (goes && !held) known.set(apt.id, { date: apt.date, timeStart: apt.time_start, at: nowMs });
  return goes;
}

