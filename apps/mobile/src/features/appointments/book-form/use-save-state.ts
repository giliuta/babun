import { useEffect, useRef } from "react";
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
  hydrated: boolean;
  /** Найденное пересечение: его жанр называет предупреждение. */
  overlap: { kind?: string | null } | null;
  timeWarning: string | null;
}

/** Can the form be saved, why not, and the slot warning worth saying aloud. */
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
  hydrated,
  overlap,
  timeWarning,
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

  // accessibilityLiveRegion — Android-only. На iOS-приложении причина под CTA,
  // предупреждение докета и ошибки оплаты озвучиваем сами, иначе весь
  // динамический фид-бек нем для VoiceOver. Объявляем при СМЕНЕ текста.
  // ОДНО ПРЕДУПРЕЖДЕНИЕ НА ОДНУ ДОРОГУ. Про нерабочее время уже
  // сказала плашка над календарём — там же человек и ответил на неё кнопкой
  // «Записать». Повторять это в форме значит спорить с его собственным
  // решением, принятым десять секунд назад.
  //
  // Но молчать совсем нельзя: время правят и ЗДЕСЬ. Поэтому график команды
  // подаёт голос ровно тогда, когда дату или время сдвинули внутри формы, —
  // это уже НОВЫЙ выбор, о котором никто не предупреждал. Пересечение с
  // другой записью не гасится никогда: о нём в календаре не говорили вовсе.
  // Снимок — только ПОСЛЕ загрузки записи: сохранённую открывают одним
  // `appointmentId`, и до гидрации форма стоит на «сегодня, 10:00». Снятый
  // тогда, он объявлял время записи «сдвинутым», и «Вне графика» загоралось
  // на записи, которую никто не трогал.
  const openedAtRef = useRef<{ date: string; time: string } | null>(null);
  if (openedAtRef.current === null && hydrated && date && timeStart) {
    openedAtRef.current = { date, time: timeStart };
  }
  const timeMovedHere =
    openedAtRef.current != null &&
    (openedAtRef.current.date !== date || openedAtRef.current.time !== timeStart);
  // ОДНО ПРЕДУПРЕЖДЕНИЕ НА ОБА ЖАНРА: считается от
  // КОМАНДЫ, а не от «записи». Слово про пересечение называет, с чем именно
  // столкнулись — у события это может быть и запись клиента, и другое
  // событие той же команды.
  const workWarning =
    overlap != null
      ? overlap.kind === "event"
        ? "Пересекается с событием этой команды"
        : "Пересекается с работой этой команды"
      : timeMovedHere
        ? timeWarning
        : null;
  useEffect(() => {
    if (!canSave && !bookingBusy && !referencesPending) {
      AccessibilityInfo.announceForAccessibility(missingHint);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- объявляем только новую подсказку, а не каждую смену флагов
  }, [missingHint]);
  useEffect(() => {
    if (workWarning) AccessibilityInfo.announceForAccessibility(workWarning);
  }, [workWarning]);

  return { canSave, workLocked, missingHint, workWarning };
}
