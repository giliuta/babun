import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useQuietMutation } from "@/lib/quiet-mutation";
// STORY-062 slice 4 — appointment writes go through the offline-aware cache
// wrappers (same 3-table scope the web caches) instead of the repo directly.
// The wrapper owns the sqlite optimistic write + online/offline branch
// (online → repo; offline → enqueue op); this hook keeps its own TanStack
// `qc` optimistic layer for instant UI. Two optimistic layers (sqlite in the
// wrapper, qc here) is intentional and correct — the qc layer paints the
// dragged block onto its slot without waiting, the sqlite layer survives an
// app restart while offline.
import {
  createAppointment,
  deleteAppointment,
} from "@babun/shared/sync/appointmentsCached";
import { isOnline, isUuid, randomUuid } from "@babun/shared/sync";
import { NEVER_PAUSE } from "@/features/finances/accounts";
import {
  listPhotoPaths,
  removePhotoBlobs,
} from "@babun/shared/db/repositories/appointment-photos";
import type { Json } from "@babun/shared/db/database.types";
import type { Appointment } from "@babun/shared/local/appointments";
import {
  undoAppointmentPayment,
} from "@babun/shared/db/repositories/finance-transactions";
import { supabase } from "@/lib/supabase";
import { preflightQuotaForCreate } from "@/lib/quota";
import { useTenantId } from "@/lib/tenant";
import { useCurrentRole } from "@/session/tenant";
import { isConfirmedNetworkUnavailable } from "@/lib/server-read-fallback";
import { useSession } from "@/providers/SessionProvider";
import { autoAssignClientLabel } from "@/features/clients/label-auto-assign";
import {
  memberCreateRow,
  isOwnRecordAlreadyCreated,
} from "@/features/appointments/member-writes";
import { appointmentsQueryKey } from "./queries";
import { invalidateKeys, useMemberRefusal } from "./mutations/shared";
import { useUpdateAppointmentOptions } from "./mutations/update";

// Shared helpers, the edit options and the partner-only doors live in
// `./mutations/`; this file stays the public entry.
export { useMemberCopyAppointment, useMemberUpdateTeam } from "./mutations/member";

export function useCreateAppointment() {
  const tenantId = useTenantId();
  const role = useCurrentRole().data;
  const { session } = useSession();
  const qc = useQueryClient();
  const refusal = useMemberRefusal();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: async (input: Appointment) => {
      if (!tenantId) throw new Error("Аккаунт ещё не открыт — попробуйте ещё раз");
      if (role === "master") {
        // Квоту месяца держит серверный триггер вставки; предпроверка —
        // удобство владельца, сотруднику она не нужна. Без сети дверь
        // сервера не откроется — офлайн-очереди у сотрудника нет.
        // Same UUID guard as the offline wrapper. createBlankAppointment falls back to a
        // NON-uuid `apt-…` id when `crypto.randomUUID` is missing — the RN/Hermes case
        // (react-native-get-random-values only polyfills getRandomValues). We stamp a
        // real RN-safe UUID before handing the blank to the offline wrapper so an
        // offline create + subsequent offline edit both key on the same valid UUID:
        // otherwise the edit lands in the update-op path with a non-uuid row_id and
        // the replayer silently drops it, losing the edit.
        const stamped = isUuid(input.id) ? input : { ...input, id: randomUuid() };
        const { error } = await supabase.rpc("member_appointment_create", {
          p_row: memberCreateRow(stamped) as Json,
        });
        // Повтор после оборванного ответа: запись уже стоит — это успех.
        if (error && !isOwnRecordAlreadyCreated(error)) {
          throw refusal("createAppointment", error.message);
        }
        // Дверь отвечает только id — он наш же; форме нужна запись целиком,
        // свежую строку довезёт перечитывание списка.
        return { ...stamped, status: "scheduled" } as Appointment;
      }
      if (role !== "owner" && role !== "dispatcher") {
        throw new Error("Роль в аккаунте ещё не подтверждена.");
      }
      await preflightQuotaForCreate(
        supabase,
        tenantId,
        "appointments_month",
        {
          online: isOnline(),
          isNetworkUnavailable: (error) =>
            isConfirmedNetworkUnavailable(
              error && typeof error === "object"
                ? (error as { code?: string; message?: string; details?: string })
                : { message: String(error) },
            ),
        },
      );
      const authoredInput =
        input.kind === "event" || input.kind === "personal"
          ? { ...input, created_by: session?.user.id ?? null }
          : input;
      const stampedOwn = isUuid(authoredInput.id)
        ? authoredInput
        : { ...authoredInput, id: randomUuid() };
      try {
        return await createAppointment(supabase, stampedOwn, tenantId);
      } catch (error) {
        // ПОВТОР ПОСЛЕ ОБОРВАННОГО ОТВЕТА — УСПЕХ, КАК У ПАРТНЁРА (бывает на
        // перезапуске базы). Первая вставка дошла, ответ — нет; номер записи
        // один на жизнь формы, и второе «Создать» било в «duplicate key value
        // violates unique constraint "appointments_pkey"» — сырой текст базы
        // вместо закрытой формы. Строка уже стоит — это та же запись.
        if (isOwnRecordAlreadyCreated(error as Error)) return stampedOwn;
        throw error;
      }
    },
    // ЗАПИСЬ ВСТАЁТ НА СЕТКУ В МОМЕНТ ТАПА. Иначе до ответа сервера идут квота
    // месяца, вставка и перечитывание списка — три поездки подряд, и запись
    // появляется спустя секунды. Список на экране получает запись сразу, как
    // у переноса (`useUpdateAppointment`); отказ сервера её убирает.
    onMutate: async (input) => {
      const key = appointmentsQueryKey(tenantId, role);
      await qc.cancelQueries({ queryKey: key });
      qc.setQueryData<Appointment[]>(key, (cur) =>
        cur && !cur.some((a) => a.id === input.id) ? [...cur, input] : cur,
      );
    },
    onError: (_err, input) => {
      qc.setQueryData<Appointment[]>(appointmentsQueryKey(tenantId, role), (cur) =>
        cur?.filter((a) => a.id !== input.id),
      );
    },
    onSuccess: (_data, input) => {
      for (const key of invalidateKeys()) qc.invalidateQueries({ queryKey: key });
      // Метка дня → метка клиента: рабочая запись в помеченный день
      // переносит метку на клиента, пока тот в авто-режиме (city_manual).
      if (
        tenantId &&
        (role === "owner" || role === "dispatcher") &&
        input.kind !== "event" &&
        input.kind !== "personal" &&
        input.status !== "cancelled" &&
        input.client_id
      ) {
        void autoAssignClientLabel({
          supabase,
          qc,
          tenantId,
          role,
          clientId: input.client_id,
          teamId: input.team_id,
          date: input.date,
          city: input.city ?? null,
        });
      }
    },
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

export function useUpdateAppointment() {
  return useMutation(useUpdateAppointmentOptions());
}

/** ТА ЖЕ ПРАВКА ЗАПИСИ — БЕЗ ПЕРЕРИСОВКИ ЗОВУЩЕГО (иначе перемещение подлагивает).
 *  `useMutation` перерисовывает экран на каждом
 *  шаге мутации (ожидание → успех), а экран календаря — три тысячи строк, и
 *  её состояние он не читает: только зовёт `mutate`. Отклики каждого вызова
 *  (`onSuccess`/`onError`) работают. */
export function useQuietUpdateAppointment() {
  return useQuietMutation(useUpdateAppointmentOptions());
}

export function useDeleteAppointment() {
  const tenantId = useTenantId();
  const role = useCurrentRole().data;
  const qc = useQueryClient();
  const refusal = useMemberRefusal();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: async (id: string) => {
      if (role !== "owner" && role !== "dispatcher" && role !== "master") {
        throw new Error("Роль в аккаунте ещё не подтверждена.");
      }
      // ФАЙЛЫ ЗАПИСИ: строки appointment_photos уходят каскадом вместе с
      // записью, а блобы в хранилище — нет (в бакете остались бы
      // файлы уже удалённых записей). Пути снимаем ДО удаления, чистим
      // после и best effort — запись важнее мусора.
      const paths = await listPhotoPaths(supabase, id).catch(() => [] as string[]);
      if (role === "master") {
        // «Отменять и удалять» (или своё событие) проверяет сервер.
        const { error } = await supabase.rpc("member_appointment_delete", {
          p_appointment_id: id,
        });
        if (error) throw refusal("deleteAppointment", error.message);
      } else {
        await deleteAppointment(supabase, id, tenantId as string);
      }
      if (paths.length > 0) void removePhotoBlobs(supabase, paths);
    },
    onSuccess: (_data, id) => {
      // СЕТКА ТЕРЯЕТ БЛОК ВМЕСТЕ С ТОСТОМ. Список ждал перечитывания: тост «Событие удалено» уже
      // висел, а блок стоял на сетке ещё секунду-две — будто удаление не
      // прошло. Сервер подтвердил — запись уходит из списка сразу.
      qc.setQueryData<Appointment[]>(appointmentsQueryKey(tenantId, role), (cur) =>
        cur?.filter((a) => a.id !== id),
      );
      for (const key of invalidateKeys()) qc.invalidateQueries({ queryKey: key });
    },
    meta: { errorHandled: true }, // call sites alert themselves
  });
}

/** Server-only because the appointment and its auto-ledger row must commit or
 * roll back together. It deliberately bypasses the offline mutation queue. */
export function useUndoAppointmentPayment() {
  const qc = useQueryClient();
  return useMutation({
    ...NEVER_PAUSE,
    mutationFn: (appointmentId: string) =>
      undoAppointmentPayment(supabase, appointmentId),
    onSuccess: () => {
      for (const key of invalidateKeys()) qc.invalidateQueries({ queryKey: key });
    },
    meta: { errorHandled: true },
  });
}

