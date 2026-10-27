import { useCallback } from "react";
import type { Appointment } from "@babun/shared/local/appointments";
import type { Client } from "@babun/shared/local/clients";
import { useSmsAccount, useTeamTemplates } from "@/features/sms/sms-account";
import { getCurrentCyprusTime } from "@babun/shared/common/utils/date-utils";
import { formatYMD } from "@/features/appointments/helpers";
import { rescheduleSmsGoes, smsOnMoveWithMemory, type KnownSlot } from "./reschedule-sms-rule";

// Время, которое знает клиент, — на всё приложение: тост переноса живёт
// дольше экрана, а сообщение ждёт минуту.
const knownSlots = new Map<string, KnownSlot>();

const nowKey = (): string => {
  const d = getCurrentCyprusTime();
  return `${formatYMD(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** «Уйдёт ли клиенту SMS» для переноса на сетке. Пока счёт SMS или шаблоны
 *  не доехали — молчит: обещать сообщение, которого не будет, хуже, чем не
 *  сказать о нём. */
export function useRescheduleSms(clients: readonly Client[]) {
  const account = useSmsAccount();
  const templates = useTeamTemplates(null);
  return useCallback(
    (apt: Appointment, teamId: string | null, date: string, timeStart: string) =>
      smsOnMoveWithMemory(knownSlots, apt, date, timeStart, rescheduleSmsGoes({
        apt,
        teamId,
        date,
        timeStart,
        client: apt.client_id ? clients.find((c) => c.id === apt.client_id) : null,
        serviceOn: account.data?.serviceOn ?? false,
        senders: account.data?.senders,
        templates: templates.data ?? [],
        now: nowKey(),
      }), Date.now()),
    [account.data, templates.data, clients],
  );
}
