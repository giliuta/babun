// Can the form be saved, and if not — the one sentence that says why.

export interface SaveVerdictInput {
  kind: "work" | "event";
  timeStart: string;
  timeEnd: string;
  failedReference: { label: string } | undefined;
  referencesPending: boolean;
  teamId: string | null;
  hasValidTeam: boolean;
  clientId: string | null;
  hasService: boolean;
  workSelectionValid: boolean;
  bookingBusy: boolean;
  archivedRecord: boolean;
}

export function saveVerdict({
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
}: SaveVerdictInput): { canSave: boolean; missingHint: string } {
  const canSave =
    timeEnd > timeStart &&
    !failedReference &&
    !referencesPending &&
    (kind === "event"
      ? teamId == null || hasValidTeam
      : clientId != null &&
        hasService &&
        hasValidTeam &&
        workSelectionValid);
  const missingHint = bookingBusy
    ? "Сохраняем…"
    : failedReference
      ? `Не удалось загрузить ${failedReference.label}`
    : referencesPending
      ? "Загружаем данные…"
    : timeEnd <= timeStart
      ? "Время окончания должно быть позже начала"
    : kind === "event"
      ? "Выберите доступный календарь"
      : // Порядок = естественный порядок заполнения: сначала называем самое
        // раннее незаполненное (клиент → команда → услуги), и только потом
        // ошибки оплаты — иначе предоплата-ошибка маскирует «Выберите клиента».
        clientId == null
        ? "Выберите клиента"
      : !hasService
        ? "Выберите услугу"
      : !hasValidTeam
        ? archivedRecord
          ? "Календарь в архиве — запись только для просмотра"
          : "Выберите команду"
      : "Проверьте услуги и мастера для этой команды";
  return { canSave, missingHint };
}
