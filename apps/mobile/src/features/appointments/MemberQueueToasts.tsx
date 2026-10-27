import { useEffect } from "react";
import { useToast } from "@/components/ui/Toast";
import { subscribeMemberQueueEvents } from "@/lib/member-queue/runtime";
import { memberOpLabel } from "@/lib/member-queue/plan";

/** Отказ сервера по правке из очереди сотрудника — тостом сразу, а не только
 *  строкой в «Синхронизации»: правка, сделанная в подвале, не должна
 *  пропасть молча. Отправка идёт вне дерева React, тост — внутри. */
export function MemberQueueToasts() {
  const toast = useToast();
  useEffect(
    () =>
      subscribeMemberQueueEvents((event) => {
        toast(`Не сохранено — ${memberOpLabel(event.op).toLowerCase()}: ${event.words}`, "error");
      }),
    [toast],
  );
  return null;
}
