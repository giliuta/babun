// Editing an appointment: the shared mutation options behind both the
// regular and the quiet (no re-render) edit hooks.
import type { UseMutationOptions } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { updateAppointment } from "@babun/shared/sync/appointmentsCached";
import { NEVER_PAUSE } from "@/features/finances/accounts";
import {
  GoneAppointmentError,
  StaleAppointmentError,
} from "@babun/shared/db/repositories/appointments";
import { markOwnWrite, OWN_WRITE_IN_FLIGHT_MS, OWN_WRITE_SETTLE_MS } from "@/lib/own-writes";
import type { Json } from "@babun/shared/db/database.types";
import type { Appointment } from "@babun/shared/local/appointments";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { useCurrentRole } from "@/session/tenant";
import { autoAssignClientLabel } from "@/features/clients/label-auto-assign";
import { memberPatch } from "@/features/appointments/member-writes";
import { appointmentsQueryKey } from "../queries";
import { clientKeys } from "@/lib/client-query-keys";
import { useMemberRefusal } from "./shared";

/** Поля «места» записи: перенос по сетке трогает только их. */
const PLACE_FIELDS = new Set(["time_start", "time_end", "date", "team_id"]);

// Fields whose change can move money server-side. A pure reschedule
// (time/date) skips the finance refetch entirely.
const FINANCE_FIELDS = [
  "status",
  "payments",
  "payment",
  "payment_status",
  "paid_amount",
  "prepaid_amount",
  "total_amount",
  "expenses",
  "client_id",
  // Смена счёта меняет, НА КАКОЙ счёт сервер положит деньги — значит
  // финансовые срезы после неё тоже устарели.
  "payment_account_id",
] as const satisfies readonly (keyof Appointment)[];

/** Правки записи в пути: id → сколько. Ответ сервера кладётся в список,
 *  только если за этой правкой не летит следующая той же записи — иначе
 *  ответ первого переноса откатывал блок со второго места на первое и
 *  обратно (два переноса подряд — «подлагивает»). */
const inFlightEdits = new Map<string, number>();

/** Последняя начатая правка каждой записи: следующая ждёт её (успех или
 *  отказ — неважно), прежде чем решать, идти в сеть или в очередь. */
const editChains = new Map<string, Promise<unknown>>();

function afterPreviousEdit<T>(id: string, run: () => Promise<T>): Promise<T> {
  const previous = editChains.get(id) ?? Promise.resolve();
  const next = previous.then(run, run);
  editChains.set(id, next);
  const forget = () => {
    if (editChains.get(id) === next) editChains.delete(id);
  };
  next.then(forget, forget);
  return next;
}

export function useUpdateAppointmentOptions() {
  const tenantId = useTenantId();
  const role = useCurrentRole().data;
  const qc = useQueryClient();
  const refusal = useMemberRefusal();
  return {
    ...NEVER_PAUSE,
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<Appointment>;
    }) => {
      if (role === "master") {
        // Каждое поле сервер проверит своим блоком (STORY-088). Поле, которого
        // дверь не знает, не выбрасываем молча — это потерянная правка.
        const kind = qc
          .getQueryData<Appointment[]>(appointmentsQueryKey(tenantId, role))
          ?.find((a) => a.id === id)?.kind;
        const { body, foreign } = memberPatch(patch, kind);
        if (foreign.length > 0) throw new Error("Это поле меняет только владелец");
        if (Object.keys(body).length === 0) return null;
        const { data, error } = await supabase.rpc("member_appointment_update", {
          p_appointment_id: id,
          p_patch: body as Json,
        });
        if (error) throw refusal("updateAppointment", error.message);
        return data;
      }
      if (role !== "owner" && role !== "dispatcher") {
        throw new Error("Роль в аккаунте ещё не подтверждена.");
      }
      // ПРАВКИ ОДНОЙ ЗАПИСИ — ПО ОЧЕРЕДИ ЖЕСТОВ. Два быстрых
      // переноса уходили в сеть разом: при медленной связи второй ложился
      // первым, а первый, оборвавшись, вставал в очередь и силой затирал
      // его — в базе оставалось место ПЕРВОГО жеста. Поэтому следующая правка
      // записи ждёт предыдущую.
      return afterPreviousEdit(id, () =>
        updateAppointment(supabase, id, patch, tenantId as string),
      );
    },
    // Optimistic: patch the cached list immediately so a drag-rescheduled
    // block lands on its new slot without waiting for the server round-trip.
    // ПАТЧ — ДО ОТМЕНЫ ЧТЕНИЯ, БЕЗ await: `await cancelQueries` откладывал
    // новое место блока ещё на поездку по очереди задач. Отмена после
    // `setQueryData` безопасна — откат летящего чтения возвращает кэш к
    // состоянию последней ручной записи, то есть к нашему патчу.
    onMutate: ({ id, patch }) => {
      inFlightEdits.set(id, (inFlightEdits.get(id) ?? 0) + 1);
      markOwnWrite(id, OWN_WRITE_IN_FLIGHT_MS);
      const key = appointmentsQueryKey(tenantId, role);
      const previous = qc.getQueryData<Appointment[]>(key);
      if (previous) {
        qc.setQueryData<Appointment[]>(
          key,
          previous.map((a) => (a.id === id ? { ...a, ...patch } : a)),
        );
      }
      void qc.cancelQueries({ queryKey: key });
      // Снапшот только своей записи: откат целым списком стирал бы
      // оптимистичный патч параллельной мутации соседней записи.
      return { prevRecord: previous?.find((a) => a.id === id) };
    },
    onSettled: (_data, _err, { id }) => {
      markOwnWrite(id, OWN_WRITE_SETTLE_MS);
      const left = (inFlightEdits.get(id) ?? 1) - 1;
      if (left > 0) inFlightEdits.set(id, left);
      else inFlightEdits.delete(id);
    },
    onError: (err, { id }, ctx) => {
      // Записи больше нет на сервере — убираем её и с экрана.
      if (err instanceof GoneAppointmentError) {
        qc.setQueryData<Appointment[]>(appointmentsQueryKey(tenantId, role), (cur) =>
          cur?.filter((a) => a.id !== id),
        );
        return;
      }
      // Запись изменилась на другом устройстве — показываем строку сервера,
      // а не нашу прежнюю копию: по ней человек и решит, что делать дальше.
      const restore =
        err instanceof StaleAppointmentError && err.fresh ? err.fresh : ctx?.prevRecord;
      if (!restore) return;
      qc.setQueryData<Appointment[]>(appointmentsQueryKey(tenantId, role), (cur) =>
        cur?.map((a) => (a.id === id ? restore : a)),
      );
    },
    onSuccess: (data, { id, patch }) => {
      // ПЕРЕНОС БЕЗ ПЕРЕЗАГРУЗКИ ВСЕГО КАЛЕНДАРЯ. Полное перечитывание списка на каждый перенос
      // перерисовывает сетку целиком второй раз, уже после оптимистичного
      // шага (свободное перемещение лагает). Когда патч трогает только место записи (время, дата, команда),
      // кладём в список ответ сервера — и всё; остальные ключи записи
      // помечаются устаревшими без немедленного похода в сеть.
      const placeOnly = Object.keys(patch).every((k) => PLACE_FIELDS.has(k));
      if (placeOnly && data && typeof data === "object" && "id" in data) {
        const listKey = appointmentsQueryKey(tenantId, role);
        // Следующая правка этой записи уже в пути — её оптимистичное место
        // главнее этого ответа (её собственный ответ придёт следом).
        if ((inFlightEdits.get(id) ?? 0) <= 1) {
          qc.setQueryData<Appointment[]>(listKey, (cur) =>
            cur?.map((a) => (a.id === id ? { ...a, ...(data as Appointment) } : a)),
          );
        }
        // Сам список свеж — ответ уже в нём. Устаревшими помечаются только
        // ДРУГИЕ ключи записей: пометка списка заставляла следующий экран
        // (форму записи) перечитать весь календарь на открытии.
        const listHash = JSON.stringify(listKey);
        qc.invalidateQueries({
          queryKey: ["appointments"],
          refetchType: "none",
          predicate: (q) => JSON.stringify(q.queryKey) !== listHash,
        });
      } else {
        qc.invalidateQueries({ queryKey: ["appointments"] });
      }
      // Finance/clients refetch only when the patch can actually move money —
      // a time_start/time_end reschedule doesn't need 3 full refetches.
      if (FINANCE_FIELDS.some((f) => patch[f] !== undefined)) {
        for (const key of [
          ["transactions"],
          clientKeys.all(),
          ["accounts"],
          ["invoices"],
          // Оплата в патче рождает чек на сервере — тот же закон, что у
          // invalidateKeys выше.
          ["receipts"],
        ]) {
          qc.invalidateQueries({ queryKey: key });
        }
      }
      // Метка следует за переносом («Перенести» / drag / смена клиента) —
      // то же правило, что при создании. Финальные team/date/client берём
      // из уже оптимистично пропатченного кэша.
      if (
        tenantId &&
        (role === "owner" || role === "dispatcher") &&
        (patch.date !== undefined ||
          patch.team_id !== undefined ||
          patch.client_id !== undefined)
      ) {
        const current = qc
          .getQueryData<Appointment[]>(appointmentsQueryKey(tenantId, role))
          ?.find((a) => a.id === id);
        if (
          current?.client_id &&
          current.kind !== "event" &&
          current.kind !== "personal" &&
          current.status !== "cancelled"
        ) {
          void autoAssignClientLabel({
            supabase,
            qc,
            tenantId,
            role,
            clientId: current.client_id,
            teamId: current.team_id,
            date: current.date,
            // Метка правленой записи — из свежего патча, а не из снимка до
            // правки: сменил метку записи, клиент запоминает новую.
            city: patch.city !== undefined ? patch.city : current.city,
          });
        }
      }
    },
  } satisfies UseMutationOptions<unknown, Error, UpdateAppointmentVars, { prevRecord?: Appointment }>;
}

type UpdateAppointmentVars = { id: string; patch: Partial<Appointment> };
