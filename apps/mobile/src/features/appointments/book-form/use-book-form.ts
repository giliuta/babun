import { useEffect, useMemo, useRef, useState } from "react";
import type { ScrollView } from "react-native";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemeColors } from "@/theme/colors";
import { useToast } from "@/components/ui/Toast";
import { useFeatureOn } from "@/features/settings/company-features";
import { useDayCities } from "@/features/reference/day-cities";
import { useTariffNudge } from "@/features/tariffs/use-tariff";
import { useKeyboardShown } from "@/lib/keyboard";
import { usePlanAllows } from "@/session/tenant";
import { first } from "./book-math";
import { useBookBlocks } from "./use-book-blocks";
import { useBookReferences } from "./use-book-references";
import { useBookDraft, type BookParams } from "./use-book-draft";
import { useBookSheets } from "./use-book-sheets";
import { useBookRights } from "./use-book-rights";
import { useClientLocations } from "./use-client-locations";
import { useTeamLabel } from "./use-team-label";
import { useBookPrefill } from "./use-book-prefill";
import { useBookTotals } from "./use-book-totals";
import { useRecordPicks } from "./use-record-picks";
import { useRecordNotes } from "./use-record-notes";
import { serviceLineActions } from "./service-line-actions";
import { useEventType } from "./use-event-type";
import { buildBookPatch } from "./book-patch";
import { openRecordPatch, type OpenRecord } from "./open-baseline";
import { referenceGate } from "./reference-gate";
import { useBookingChain } from "./use-booking-chain";
import { useReferenceRetry } from "./use-reference-retry";
import { useSaveState } from "./use-save-state";
import { useLeaveGuard } from "./use-leave-guard";
import { bookSaveActions } from "./book-save";
import { bookChrome, bookTitle } from "./book-chrome";
import { useRecordMenu } from "./use-record-menu";
import { recordComment } from "@/features/calendar/record-title";
import { useTenantId } from "@/lib/tenant";
import { paramsWithDraft } from "./book-draft-store";
import { applyBookSnapshot } from "./apply-book-snapshot";
import {
  usePersistBookDraft,
  useRestoreEditDraft,
  useRestoredBookDraft,
} from "./use-book-draft-memory";
import { useDeletedClientNames } from "@/features/clients/queries";
import { useEventPlaceTypeLive } from "./use-event-place-type-live";
import { useLocationLabels } from "@/features/settings/local-settings";

/** The booking form's whole state and behaviour, composed in the order the
 *  hooks (and so their effects) always ran. `app/book/index.tsx` renders it. */
export function useBookForm() {
  const t = useThemeColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();
  // Прокрутка формы — чтобы поле, получившее фокус в самом низу, показать
  // над клавиатурой: KAV сжимает список, но к сфокусированному полю сам не
  // едет, и заметку набирали вслепую.
  const scrollRef = useRef<ScrollView>(null);
  const keyboardShown = useKeyboardShown();
  const toast = useToast();
  // БЕЗ ТАРИФА ЗАПИСЬ КЛИЕНТА ТОЛЬКО СМОТРЯТ (иначе за бесплатный срок можно наставить записей наперёд и
  // добавить туда клиентов). Страница открывается, «Сохранить» серая, тап — плашка про тариф; сервер
  // держит то же (`tenant_free_readonly_guard`).
  // ОДНО МЕСТО ЗАМКА ТАРИФА ФОРМЫ: клиент, объект клиента, запись клиента и её
  // оплата смотрят только сюда. Объект самого события и прочее в событии
  // тарифом не заперты. Тариф переедет в календарь — меняется эта строка.
  const workInPlan = usePlanAllows("book-clients");
  const nudgeTariff = useTariffNudge();
  // Колонка типа объекта события — после наката; до него типа у события нет.
  const eventPlaceTypeLive = useEventPlaceTypeLive();
  const { data: dayCities = {} } = useDayCities();
  const dayLabelsOn = useFeatureOn("day_labels");
  const params = useLocalSearchParams<BookParams>();
  // ЧЕРНОВИК НОВОЙ ЗАПИСИ — С ТЕЛЕФОНА (`book-draft-store.ts`). Поднятый
  // проходит через умолчания формы своими командой, клиентом, днём и часом;
  // «что ввёл человек» по-прежнему сверяется с настоящими параметрами.
  const tenantId = useTenantId();
  const draftMemory = useRestoredBookDraft(
    tenantId,
    first(params.appointmentId) ?? null,
    first(params.kind) === "event" ? "event" : "work",
    first(params.copyOf) != null,
  );
  const formParams = useMemo(
    () => paramsWithDraft(params, draftMemory.restored),
    [params, draftMemory.restored],
  );
  const [teamId, setTeamId] = useState<string | null>(
    first(formParams.teamId) ?? null,
  );
  const look = useBookBlocks(teamId);
  // «Типы объектов» команды записи — у объекта события без клиента (`event-place.ts`).
  const { data: placeTypePresets = [] } = useLocationLabels(teamId);
  const refs = useBookReferences(teamId);
  const { teams, masters, services, clients, allAppts, calendarSettings } = refs;
  const draft = useBookDraft({
    params: formParams,
    teamId,
    setTeamId,
    allAppts,
    restored: draftMemory.restored,
  });
  const { isEdit, editing, kind, clientId, date, timeStart, timeEnd, serviceIds } = draft;
  const sheets = useBookSheets();

  const client = useMemo(
    () => clients.find((c) => c.id === clientId) ?? null,
    [clients, clientId],
  );
  // КЛИЕНТ ЗАПИСИ УДАЛЁН — имя только для подписи блока и меню: клиентом
  // формы он не становится (ни объектов, ни заметки, ни телефона).
  const deletedNames = useDeletedClientNames();
  const deletedClientName = !client && clientId ? (deletedNames.get(clientId) ?? null) : null;
  const access = useBookRights({ client, kind, isEdit, editing, teamId, workInPlan });
  const places = useClientLocations({
    client,
    clients,
    locationId: draft.locationId,
    setLocationId: draft.setLocationId,
    setAddress: draft.setAddress,
  });
  const label = useTeamLabel({
    isEdit,
    allTeams: refs.allTeams,
    teams,
    teamId,
    client,
    clientId,
    calendarSettings,
    dayCities,
    teamCities: draft.teamCities,
    date,
    dayLabelsOn,
    city: draft.city,
    cityTouched: draft.cityTouched,
    setCity: draft.setCity,
    toast,
  });
  const { team } = label;
  // Hook inputs below take same-named fields straight from `refs` / `draft`.
  useBookPrefill({
    ...refs,
    ...draft,
    params: formParams,
    team,
    teamId,
    setTeamId,
    teamsQuerySuccess: refs.teamsQuery.isSuccess,
    servicesQuerySuccess: refs.servicesQuery.isSuccess,
    mastersQuerySuccess: refs.mastersQuery.isSuccess,
  });
  // ДАТА ВИЗИТА ПОД ИМЕНЕМ КЛИЕНТА — как в списке клиентов (имя, номер телефона и дата
  // последнего визита; долга и визитов в блоке записи нет — они на странице
  // клиента).
  const clientStats = client ? refs.statsById.get(client.id) : undefined;
  const totals = useBookTotals({
    ...draft,
    catalog: refs.catalog,
    nameById: refs.nameById,
    client,
    teamName: team?.name ?? null,
    showMoney: access.can.showMoney,
    editingId: editing?.id ?? null,
    teamId,
    slotFallback: label.slotFallback,
  });
  const picks = useRecordPicks({
    ...refs,
    ...draft,
    ...sheets,
    ...places,
    client,
    teamId,
    setTeamId,
    workInPlan,
    router,
  });
  const notes = useRecordNotes({
    client,
    clientId,
    teamId,
    locationId: draft.locationId,
    selectedLocation: places.selectedLocation,
    eventLocationEntry: places.eventLocationEntry,
    eventLocationOwner: places.eventLocationOwner,
    updateClient: draft.updateClient,
  });
  const lines = serviceLineActions({
    setServiceIds: draft.setServiceIds,
    setOverrides: draft.setOverrides,
    setTotalSheetOpen: sheets.setTotalSheetOpen,
    selectedServices: totals.selectedServices,
    catalog: refs.catalog,
  });
  const eventKind = useEventType({ ...draft, eventTypesData: refs.eventTypesQuery.data });

  const buildPatch = () =>
    buildBookPatch({
      ...draft,
      ...totals,
      teamId,
      eventLoc: places.eventLocationEntry?.loc ?? null,
      eventPlaceTypeLive,
      eventTypeLabel: eventKind.eventType?.label ?? null,
      // The note as typed right now, not the settled `comment` state.
      comment: draft.commentNow.current,
      clientLocations: places.clientLocations,
      client,
    });

  const gate = referenceGate({
    kind,
    isEdit,
    teamId,
    teamsQuery: refs.teamsQuery,
    mastersQuery: refs.mastersQuery,
    servicesQuery: refs.servicesQuery,
    clientsQuery: refs.clientsQuery,
    appointmentsQuery: refs.appointmentsQuery,
    calendarSettingsQuery: refs.calendarSettingsQuery,
    eventTypesQuery: refs.eventTypesQuery,
    teamScheduleQuery: draft.teamScheduleQuery,
  });
  const { failedReference, referencesPending } = gate;
  useBookingChain({
    chainStep: picks.chainStep,
    setChainStep: picks.setChainStep,
    // Поднятый черновик — запись на середине: цепочка «клиент → услуги» не
    // начинается заново, и её лист не накрывает плашку «Удалить черновик».
    isEdit: isEdit || draftMemory.restored != null,
    kind,
    referencesPending,
    clientId,
    setClientPickerOpen: sheets.setClientPickerOpen,
    servicesPending: refs.servicesQuery.isPending,
    serviceIdsCount: serviceIds.length,
    teamServicesCount: refs.teamServices.length,
    setServicePickerOpen: sheets.setServicePickerOpen,
  });
  const failedOptional = useReferenceRetry(gate.referenceQueries, gate.essentialQueries);
  const bookingBusy = refs.booking.isPending || draft.updateMut.isPending;
  const verdict = useSaveState({
    kind,
    isEdit,
    teamId,
    teams,
    serviceIds,
    masterId: draft.masterId,
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
    archivedRecord: label.archivedRecord,
  });
  // Что на форме сейчас — тем же видом, что ложится в черновик на телефоне.
  const snapshot = {
    kind,
    teamId,
    clientId,
    locationId: draft.locationId,
    address: draft.address,
    date,
    timeStart,
    timeEnd,
    durationTouched: draft.durationTouched,
    durationByHand: draft.durationByHand,
    serviceIds,
    overrides: draft.overrides,
    masterId: draft.masterId,
    customTotal: draft.customTotal,
    totalDraft: draft.totalDraft,
    discountType: draft.discountType,
    discountValue: draft.discountValue,
    recordVatMode: draft.recordVatMode,
    recordVatRate: draft.recordVatRate,
    status: draft.status,
    // Набранное прямо сейчас, а не осевшее на blur: последние буквы заметки
    // иначе не попадали в снимок.
    comment: draft.commentNow.current,
    eventTitle: draft.eventTitle,
    eventColor: draft.eventColor,
    eventTypeId: draft.eventTypeId,
    eventNotes: draft.eventNotes,
    eventAddress: draft.eventAddress,
    eventPlacePin: draft.eventPlacePin,
    eventPlaceNote: draft.eventPlaceNote,
    eventPlaceTypeId: draft.eventPlaceTypeId,
    eventUrl: draft.eventUrl,
    eventReminderOffset: draft.eventReminderOffset,
    repeat: draft.repeat,
    allDay: draft.allDay,
    reminderOn: draft.reminderOn,
    colorOverride: draft.colorOverride,
    city: draft.city,
    newRecordId: draft.newRecordIdRef.current,
    cityTouched: draft.cityTouched,
  };
  // ЭТАЛОН ПРАВКИ (№17) — состояние формы в кадр загрузки записи, ДО подъёма
  // прерванной правки (`useRestoreEditDraft` ниже). Патч из него собирается
  // на каждом кадре на тех же справочниках, что и патч формы
  // (`open-baseline.ts`): доехавший каталог, клиент или ставка двигают обе
  // стороны, и нетронутая запись не «изменена».
  const [openRecord, setOpenRecord] = useState<OpenRecord | null>(null);
  useEffect(() => {
    if (!isEdit || !draft.hydrated || openRecord) return;
    const { newRecordId: _id, ...open } = snapshot;
    setOpenRecord({ ...open, discountReason: draft.discountReason });
    // Один раз на открытие: снимок — значения этого же кадра.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, draft.hydrated]);
  const baselineSignature = openRecord
    ? JSON.stringify(
        openRecordPatch(openRecord, {
          isEdit,
          catalog: refs.catalog,
          rememberedRate: draft.rememberedVatRate.rate,
          client: clients.find((c) => c.id === openRecord.clientId) ?? null,
          eventTypeLabel:
            eventKind.eventTypes.find((type) => type.id === openRecord.eventTypeId)?.label ?? null,
          eventLoc:
            places.eventLocationPool.find((row) => row.loc.id === openRecord.locationId)?.loc ?? null,
          clientLocations: places.clientLocations,
          eventPlaceTypeLive,
        }),
      )
    : null;
  const guard = useLeaveGuard({
    isEdit,
    buildPatch,
    baselineSignature,
    clientNote: notes.clientNote,
    objectNote: notes.objectNote,
    eventObjectNote: notes.eventObjectNote,
    draft: {
      ...draft,
      pendingFilesCount: draft.pendingFiles.length,
      dateTouched: draft.dateTouchedRef.current,
      serviceIdsCount: serviceIds.length,
      hasPendingPayment: draft.pendingPayment != null,
      initialClientId: first(params.clientId) ?? null,
      initialLocationId: first(params.locationId) ?? null,
    },
    from: params.from,
    saveable: verdict.canSave && !verdict.workLocked,
    missingHint: verdict.canSave ? undefined : verdict.missingHint,
    navigation,
    router,
    onDiscardDraft: draftMemory.forget,
  });
  const editOpened = useRestoreEditDraft({
    memory: draftMemory,
    tenantId,
    editing: draft.editing,
    hydrated: draft.hydrated,
    // Снимок, равный записи при открытии, — не правка: его писала форма,
    // считавшая себя изменённой без рук (№17).
    apply: (snap) => applyBookSnapshot(draft, setTeamId, snap),
    current: snapshot,
    toast,
    router,
  });
  usePersistBookDraft({
    memory: draftMemory,
    tenantId,
    isEdit,
    edit: editOpened,
    dirty: guard.dirty,
    snapshot,
    toast,
    router,
  });
  const actions = bookSaveActions({
    ...draft,
    canSave: verdict.canSave,
    bookingBusy,
    missingHint: verdict.missingHint,
    toast,
    clientNote: notes.clientNote,
    objectNote: notes.objectNote,
    editBaselineRef: guard.editBaselineRef,
    buildPatch,
    effectiveTotal: totals.effectiveTotal,
    booking: refs.booking,
    team,
    calendarSettings,
    client,
    setReminderSheetOpen: sheets.setReminderSheetOpen,
    leaveBook: guard.leaveBook,
    onSaved: draftMemory.forget,
  });
  // «Сохранить» из вопроса при выходе — та же кнопка, что внизу формы.
  guard.saveRef.current = actions.save;

  const title = bookTitle(isEdit, kind);
  const menu = useRecordMenu({
    isEdit,
    editing,
    hydrated: draft.hydrated,
    archivedRecord: label.archivedRecord,
    workInPlan,
    nudgeTariff,
    menuTitle:
      client?.full_name?.trim() || deletedClientName || (editing ? recordComment(editing) : "") || title,
    setStatus: draft.setStatus,
    editBaselineRef: guard.editBaselineRef,
    leaveBook: guard.leaveBook,
    leaveThen: guard.leaveThen,
    toast,
    router,
  });
  const chrome = bookChrome({
    kind,
    eventColor: draft.eventColor,
    colorOverride: draft.colorOverride,
    autoColorRule: look.autoColorRule,
    teamColor: team?.color,
    labelColor: draft.teamCities.find((c) => c.name === label.effectiveLabel)?.color,
    serviceIds,
    serviceColorById: refs.serviceColorById,
    editing,
    date,
    clientId,
    locationId: draft.locationId,
    address: draft.address,
    customTotal: draft.customTotal,
    effectiveTotal: totals.effectiveTotal,
    todayYmd: label.todayYmd,
    nowMinutes: label.nowMinutes,
    situationPalette: look.situationPalette,
    activeSituations: look.activeSituations,
    cancelledColor: look.cancelledColor,
    paidColor: look.paidColor,
    prepaidColor: look.prepaidColor,
    fallbackColor: look.fallbackColor,
    accent: t.accent,
    canvas: t.canvas,
  });

  return {
    t,
    insets,
    router,
    scrollRef,
    keyboardShown,
    toast,
    workInPlan,
    nudgeTariff,
    teamId,
    eventPlaceTypeLive,
    placeTypePresets,
    ...look,
    ...refs,
    ...draft,
    ...sheets,
    client,
    deletedClientName,
    ...access,
    ...places,
    ...label,
    clientStats,
    ...totals,
    ...picks,
    ...notes,
    ...lines,
    ...eventKind,
    ...gate,
    failedOptional,
    bookingBusy,
    ...verdict,
    ...guard,
    ...actions,
    title,
    ...menu,
    ...chrome,
  };
}

export type BookModel = ReturnType<typeof useBookForm>;
