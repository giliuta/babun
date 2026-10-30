import { useEffect } from "react";
import { AccessibilityInfo } from "react-native";
import type { Service } from "@/features/services/queries";
import type { Master, Team } from "@/features/reference/queries";
import { reconcileBookingSelection } from "@/features/appointments/booking-selection";
import type { GateRef } from "./reference-gate";
import { saveVerdict } from "./save-verdict";

interface SaveStateInput {
  kind: "work" | "event";
  isEdit: boolean;
  teamId: string | null;
  teams: Team[];
  serviceIds: string[];
  masterId: string | null;
  services: Service[];
  masters: Master[];
  clientId: string | null;
  date: string;
  timeStart: string;
  timeEnd: string;
  failedReference: GateRef | undefined;
  referencesPending: boolean;
  bookingBusy: boolean;
  workInPlan: boolean;
  archivedRecord: boolean;
}

/** Can the form be saved and why not. */
export function useSaveState({
  kind,
  isEdit,
  teamId,
  teams,
  serviceIds,
  masterId,
  services,
  masters,
  clientId,
  date,
  timeStart,
  timeEnd,
  failedReference,
  referencesPending,
  bookingBusy,
  workInPlan,
  archivedRecord,
}: SaveStateInput) {
  const hasValidTeam =
    teamId != null && teams.some((candidate) => candidate.id === teamId);
  const reconciledSelection = reconcileBookingSelection({
    teamId,
    serviceIds,
    masterId,
    services,
    masters,
  });
  // Сверка держит СОЗДАНИЕ: пока черновик собирается, услуга чужой команды в
  // него попасть не должна. Сохранённую запись она не судит — там строки
  // держит замок снимка, и услуга, убранная из каталога полгода назад, не
  // повод запретить правку комментария.
  const workSelectionValid =
    isEdit ||
    (reconciledSelection.masterId === masterId &&
      reconciledSelection.serviceIds.join("\u0000") ===
        serviceIds.join("\u0000"));
  // ЗАПИСЬ КЛИЕНТА = КЛИЕНТ + УСЛУГА: без клиента это событие, без услуги нельзя
  // сохранить. «Сохранить» остаётся нажимаемым и говорит
  // сверху, чего не хватает.
  const hasService = serviceIds.length > 0;
  const workLocked = kind === "work" && !workInPlan;
  const { canSave, missingHint } = saveVerdict({
    kind,
    timeStart,
    timeEnd,
    failedReference,
    referencesPending,
    teamId,
    hasValidTeam,
    clientId,
    hasService,
    workSelectionValid,
    bookingBusy,
    archivedRecord,
  });

  // accessibilityLiveRegion — Android-only. На iOS причину под CTA озвучиваем
  // сами, иначе она нема для VoiceOver. Объявляем при СМЕНЕ текста.
  //
  // ПРЕДУПРЕЖДЕНИЙ О ВРЕМЕНИ В ФОРМЕ НЕТ. «Пересекается с работой», «Вне
  // графика», «Нерабочий день», «Меньше N мин на дорогу» висели жёлтой
  // плашкой под временем: человек и так видит календарь, в котором ставит
  // запись, а постоянная плашка режет глаз (владелец). Что не так — скажет
  // сервер тостом сверху при сохранении.
  useEffect(() => {
    if (!canSave && !bookingBusy && !referencesPending) {
      AccessibilityInfo.announceForAccessibility(missingHint);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- объявляем только новую подсказку, а не каждую смену флагов
  }, [missingHint]);
  return { canSave, workLocked, missingHint };
}
