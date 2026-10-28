import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { Appointment } from "@babun/shared/local/appointments";
import { duplicateAppointment } from "@babun/shared/local/appointments";
import type { Client } from "@babun/shared/local/clients";
import type { CalendarSettings } from "@babun/shared/local/calendar-settings";
import { getCurrentTimeInZone } from "@babun/shared/common/utils/date-utils";
import type { Service } from "@/features/services/queries";
import type { Master, Team } from "@/features/reference/queries";
import {
  resolveBookingClientPrefill,
  resolveBookingTeamId,
} from "@/features/appointments/booking-prefill";
import { reconcileBookingSelection } from "@/features/appointments/booking-selection";
import { formatYMD, type ServiceOverride } from "@/features/appointments/helpers";
import { first } from "./book-math";
import type { BookParams } from "./use-book-draft";

type Setter<T> = Dispatch<SetStateAction<T>>;

interface BookPrefillInput {
  params: BookParams;
  isEdit: boolean;
  editing: Appointment | null;
  hydrate: (editing: Appointment) => void;
  /** Список календаря — из него берётся оригинал копии (`params.copyOf`). */
  allAppts: Appointment[];
  team: Team | null | undefined;
  calendarSettings: CalendarSettings | undefined;
  date: string;
  setDate: Setter<string>;
  dateTouchedRef: MutableRefObject<boolean>;
  teams: Team[];
  teamsLoading: boolean;
  lastTeamId: string | null;
  teamId: string | null;
  setTeamId: Setter<string | null>;
  teamsQuerySuccess: boolean;
  servicesQuerySuccess: boolean;
  mastersQuerySuccess: boolean;
  services: Service[];
  masters: Master[];
  serviceIds: string[];
  setServiceIds: Setter<string[]>;
  setOverrides: Setter<Record<string, ServiceOverride>>;
  masterId: string | null;
  setMasterId: Setter<string | null>;
  clients: Client[];
  clientsLoading: boolean;
  setClientId: Setter<string | null>;
  setLocationId: Setter<string | null>;
  setAddress: Setter<string>;
}

/** Defaults of a new record (date, team, link prefill) and the one-time load
 *  of an existing record into the draft. Effects keep their original order. */
export function useBookPrefill({
  params,
  isEdit,
  editing,
  hydrate,
  allAppts,
  team,
  calendarSettings,
  date,
  setDate,
  dateTouchedRef,
  teams,
  teamsLoading,
  lastTeamId,
  teamId,
  setTeamId,
  teamsQuerySuccess,
  servicesQuerySuccess,
  mastersQuerySuccess,
  services,
  masters,
  serviceIds,
  setServiceIds,
  setOverrides,
  masterId,
  setMasterId,
  clients,
  clientsLoading,
  setClientId,
  setLocationId,
  setAddress,
}: BookPrefillInput) {
  // The first render's date — the seed the timezone default may replace.
  const dateSeedRef = useRef(date);

  // A direct /book open has no calendar date parameter. Resolve that default
  // in the selected brigade's wall clock (or the company timezone), so a
  // dispatcher working around midnight does not create a job on the device's
  // date by accident. Never overwrite a date the operator already touched.
  useEffect(() => {
    if (first(params.date) || dateTouchedRef.current) return;
    const timeZone = team?.timezone ?? calendarSettings?.timezone;
    if (!timeZone || date !== dateSeedRef.current) return;
    const next = formatYMD(getCurrentTimeInZone(timeZone));
    dateSeedRef.current = next;
    if (next !== date) setDate(next);
  }, [calendarSettings?.timezone, date, params.date, team?.timezone, dateTouchedRef, setDate]);

  // ═══ ГИДРАЦИЯ ПРАВКИ ═══
  //
  // Один раз, когда запись доехала из кеша. Дальше страница живёт обычной
  // жизнью: все умные дефолты ниже (команда, префилл клиента, авто-конец)
  // выключены в режиме правки — им нечего доопределять, а
  // затереть сохранённое они могут. Что именно ложится в черновик —
  // `hydrate` в `use-book-draft.ts`.
  const editHydrated = useRef(false);
  useEffect(() => {
    if (!isEdit || editHydrated.current || !editing) return;
    editHydrated.current = true;
    hydrate(editing);
  }, [isEdit, editing, hydrate]);

  // ═══ КОПИЯ ═══ — те же поля, что у правки, но запись новая: без денег,
  // статуса и повтора (`duplicateAppointment`), в дне, который пришёл
  // параметром (у вхождения повтора он свой). Копия, созданная до формы,
  // оставалась дублем в дне у того, кто вышел, ничего не нажав (CAL-33).
  const copyOf = first(params.copyOf);
  const copySource = copyOf ? allAppts.find((a) => a.id === copyOf) ?? null : null;
  const copyHydrated = useRef(false);
  useEffect(() => {
    if (isEdit || copyHydrated.current || !copySource) return;
    copyHydrated.current = true;
    hydrate({ ...duplicateAppointment(copySource), date: first(params.date) ?? copySource.date });
  }, [isEdit, copySource, hydrate, params.date]);

  // ── дефолт команды при первом рендере (params → последняя → первая) ──
  const teamSeeded = useRef(false);
  const clientPrefillHydrated = useRef(false);
  useEffect(() => {
    if (isEdit) return;
    if (teamSeeded.current || teamsLoading) return;
    const resolved = resolveBookingTeamId(
      first(params.teamId),
      teams,
      lastTeamId,
    );
    if (teamId !== resolved) setTeamId(resolved);
    teamSeeded.current = true;
  }, [isEdit, teams, teamsLoading, lastTeamId, teamId, params.teamId, setTeamId]);

  // Reference data can arrive in a different order. Reconcile URL/client
  // prefills after every successful catalog refresh so stale selections can
  // never be submitted under the wrong brigade.
  //
  // ПРАВКУ НЕ СВЕРЯЕМ. У сохранённой записи услуга могла уехать из каталога
  // или сменить команду — и тогда сверка молча вычистила бы оплаченные
  // строки из чужой записи. Их держит замок снимка, а не сегодняшний прайс.
  useEffect(() => {
    if (isEdit) return;
    if (!teamsQuerySuccess || !servicesQuerySuccess || !mastersQuerySuccess) {
      return;
    }
    const next = reconcileBookingSelection({
      teamId,
      serviceIds,
      masterId,
      services,
      masters,
    });
    if (next.serviceIds.join("\u0000") !== serviceIds.join("\u0000")) {
      setServiceIds(next.serviceIds);
      const keep = new Set(next.serviceIds);
      setOverrides((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([serviceId]) => keep.has(serviceId)),
        ),
      );
    }
    if (next.masterId !== masterId) setMasterId(next.masterId);
  }, [
    isEdit,
    masterId,
    masters,
    mastersQuerySuccess,
    serviceIds,
    services,
    servicesQuerySuccess,
    teamId,
    teamsQuerySuccess,
    setServiceIds,
    setOverrides,
    setMasterId,
  ]);

  // Карточка клиента открывает /book уже с clientId/locationId. Это должно
  // заполнить ТОТ ЖЕ snapshot адреса, что ручной выбор ниже; иначе запись
  // сохраняла location_id с пустыми address/address_note. Гидратируем ровно
  // один раз после загрузки клиентов, чтобы не перетирать ручной ввод адреса.
  useEffect(() => {
    if (isEdit) return;
    if (clientPrefillHydrated.current || clientsLoading) return;
    const requestedClientId = first(params.clientId);
    if (!requestedClientId) {
      clientPrefillHydrated.current = true;
      return;
    }
    const requestedClient = clients.find(
      (item) => item.id === requestedClientId,
    );
    if (!requestedClient) {
      setClientId(null);
      setLocationId(null);
      clientPrefillHydrated.current = true;
      return;
    }
    const prefill = resolveBookingClientPrefill(
      requestedClient,
      first(params.locationId),
    );
    setClientId(prefill.clientId);
    setLocationId(prefill.locationId);
    setAddress(prefill.address);
    if (prefill.masterId) setMasterId(prefill.masterId);
    clientPrefillHydrated.current = true;
  }, [
    isEdit,
    clients,
    clientsLoading,
    params.clientId,
    params.locationId,
    setClientId,
    setLocationId,
    setAddress,
    setMasterId,
  ]);
}
