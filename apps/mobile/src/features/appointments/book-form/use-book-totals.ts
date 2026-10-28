import { useEffect, useMemo, type Dispatch, type SetStateAction } from "react";
import type { Discount } from "@babun/shared/local/appointments";
import { isCustomServiceId } from "@babun/shared/local/appointments";
import type { Client } from "@babun/shared/local/clients";
import type { TxVatMode } from "@babun/shared/local/finance/vat";
import type { Service } from "@/features/services/queries";
import { durationLabel } from "@/lib/service-format";
import { useTenant } from "@/session/tenant";
import { smsVars } from "@/features/sms/sms-compose";
import { addressedAs, firstName } from "@/lib/sms-name";
import { addMinutesHM, type ServiceOverride } from "@/features/appointments/helpers";
import { totalDraftText } from "./book-money";
import { bookTotalsMath } from "./book-totals-math";

interface BookTotalsInput {
  serviceIds: string[];
  catalog: Map<string, Service>;
  overrides: Record<string, ServiceOverride>;
  nameById: Map<string, string>;
  discountType: Discount["type"] | null;
  discountValue: string;
  discountReason: string | null;
  recordVatMode: TxVatMode;
  recordVatRate: number | null;
  rememberedVatRate: { rate: number };
  customTotal: boolean;
  totalDraft: string;
  setTotalDraft: Dispatch<SetStateAction<string>>;
  // SMS
  client: Client | null;
  date: string;
  timeStart: string;
  teamName: string | null;
  address: string;
  showMoney: boolean;
  editingId: string | null;
  teamId: string | null;
  // auto end
  hydrated: boolean;
  durationTouched: boolean;
  slotFallback: number;
  setTimeEnd: Dispatch<SetStateAction<string>>;
}

/** Lines, duration, discount, VAT and the amount due — plus what follows them. */
export function useBookTotals({
  serviceIds,
  catalog,
  overrides,
  nameById,
  discountType,
  discountValue,
  discountReason,
  recordVatMode,
  recordVatRate,
  rememberedVatRate,
  customTotal,
  totalDraft,
  setTotalDraft,
  client,
  date,
  timeStart,
  teamName,
  address,
  showMoney,
  editingId,
  teamId,
  hydrated,
  durationTouched,
  slotFallback,
  setTimeEnd,
}: BookTotalsInput) {
  // ── производные суммы ── — тем же расчётом, что эталон «как было» у
  // правки (`bookTotalsMath`): две копии разошлись бы, и нетронутая запись
  // считалась бы изменённой.
  const math = useMemo(
    () =>
      bookTotalsMath({
        serviceIds,
        catalog,
        overrides,
        discountType,
        discountValue,
        discountReason,
        recordVatMode,
        recordVatRate,
        rememberedRate: rememberedVatRate.rate,
        customTotal,
        totalDraft,
      }),
    [
      serviceIds, catalog, overrides, discountType, discountValue, discountReason,
      recordVatMode, recordVatRate, rememberedVatRate.rate, customTotal, totalDraft,
    ],
  );
  const { selectedServices, computedDuration, globalDiscount, discountAmount, vatRateInUse } = math;
  const { beforeVat, automaticTotal, effectiveTotal } = math;

  // ПЕРЕВОД «УСЛУГА ЗАПИСИ → СТРОКА БЛОКА» — ОДИН НА ЭКРАН. Его читают и блок
  // «Услуги», и шторка «Итого»; две копии этого перевода разъехались бы на
  // первой же правке — имя строки в одном месте бралось бы из снимка, в другом
  // из сегодняшнего прайса.
  const serviceLines = useMemo(
    () =>
      selectedServices.map((line) => ({
        id: line.serviceId,
        name: line.serviceName ?? nameById.get(line.serviceId) ?? "Услуга удалена",
        // Вторая строка у записи — длительность работы.
        // У своей строки времени нет — второй строки тоже.
        subtitle: isCustomServiceId(line.serviceId) ? null : durationLabel(line.duration),
        qty: line.quantity,
        unit: line.unit ?? catalog.get(line.serviceId)?.unit ?? null,
        pricePerUnit: line.pricePerUnit,
        total: line.totalPrice,
        // Своя строка: имя правится в «Итого».
        ...(isCustomServiceId(line.serviceId) ? { editableName: line.serviceName ?? "" } : {}),
      })),
    [catalog, nameById, selectedServices],
  );


  // ЧТО ПОДСТАВИТ ШАБЛОН SMS ИЗ ЭТОЙ ЗАПИСИ (STORY-089): «SMS» у номера
  // клиента открывает шаблоны, заполненные ровно тем, что на экране. Сумму
  // берёт только тот, кому деньги записи видны, — иначе SMS показала бы ему
  // цену, которую страница прячет.
  const companyName = useTenant().data?.name ?? null;
  const recordSmsVars = useMemo(
    () =>
      client
        ? smsVars({
            name: addressedAs(client, firstName(client)),
            date,
            time: timeStart,
            calendar: teamName,
            services: serviceLines.map((line) => line.name),
            address,
            total: showMoney ? effectiveTotal : null,
            company: companyName,
          })
        : null,
    [address, showMoney, client, companyName, date, effectiveTotal, serviceLines, teamName, timeStart],
  );
  // Сервису нужны ещё запись, клиент и календарь: SMS через сервис владелец
  // разрешает по календарям (STORY-089).
  //
  // КЛИЕНТ СМЕНЁН, НО НЕ СОХРАНЁН — SMS всё равно о записи: сервер
  // шлёт клиенту на экране (`sms_send_manual` берёт присланного клиента, а не
  // сохранённого), и SMS ложится в блок SMS этой записи.
  const recordSmsContext = useMemo(
    () =>
      recordSmsVars
        ? {
            vars: recordSmsVars,
            appointmentId: editingId,
            clientId: client?.id ?? null,
            teamId: teamId ?? null,
            optOut: client?.sms_opt_out === true,
          }
        : null,
    [client?.id, client?.sms_opt_out, editingId, recordSmsVars, teamId],
  );

  // Keep the editable total in sync with catalog pricing until the operator
  // explicitly changes it. A manual amount then stays stable while services
  // are adjusted; «По услугам» reconnects it to the automatic calculation.
  useEffect(() => {
    if (!hydrated) return;
    if (customTotal) return;
    setTotalDraft(totalDraftText(automaticTotal));
  }, [automaticTotal, customTotal, hydrated, setTotalDraft]);

  // ── авто-конец = старт + Σ длительности (растёт, не трогали руками) ──
  useEffect(() => {
    if (!hydrated) return;
    if (durationTouched) return;
    const grow = computedDuration > 0 ? computedDuration : slotFallback;
    setTimeEnd(addMinutesHM(timeStart, grow));
  }, [timeStart, computedDuration, durationTouched, slotFallback, hydrated, setTimeEnd]);

  return {
    selectedServices,
    computedDuration,
    globalDiscount,
    serviceLines,
    discountAmount,
    vatRateInUse,
    beforeVat,
    effectiveTotal,
    recordSmsContext,
  };
}
