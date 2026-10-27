import { useMemo, useRef, useState } from "react";
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
import { useSlotWarnings } from "./use-slot-warnings";
import { useRecordPicks } from "./use-record-picks";
import { useRecordNotes } from "./use-record-notes";
import { serviceLineActions } from "./service-line-actions";
import { useEventType } from "./use-event-type";
import { buildBookPatch } from "./book-patch";
import { referenceGate } from "./reference-gate";
import { useBookingChain } from "./use-booking-chain";
import { useReferenceRetry } from "./use-reference-retry";
import { useSaveState } from "./use-save-state";
import { useLeaveGuard } from "./use-leave-guard";
import { bookSaveActions } from "./book-save";
import { bookChrome, bookTitle } from "./book-chrome";
import { useRecordMenu } from "./use-record-menu";
import { recordComment } from "@/features/calendar/record-title";

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
  const workInPlan = usePlanAllows("book-clients");
  const nudgeTariff = useTariffNudge();
  const { data: dayCities = {} } = useDayCities();
  const dayLabelsOn = useFeatureOn("day_labels");
  const params = useLocalSearchParams<BookParams>();
  const [teamId, setTeamId] = useState<string | null>(
    first(params.teamId) ?? null,
  );
  const look = useBookBlocks(teamId);
  const refs = useBookReferences(teamId);
  const { teams, masters, services, clients, allAppts, calendarSettings } = refs;
  const draft = useBookDraft({ params, teamId, setTeamId, allAppts });
  const { isEdit, editing, kind, clientId, date, timeStart, timeEnd, serviceIds } = draft;
  const sheets = useBookSheets();

  const client = useMemo(
    () => clients.find((c) => c.id === clientId) ?? null,
    [clients, clientId],
  );
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
    params,
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
  const slot = useSlotWarnings({
    allAppts,
    editId: draft.editId,
    kind,
    teamId,
    date,
    timeStart,
    timeEnd,
    schedule: draft.teamScheduleQuery.data,
    calendarSettings,
    teams,
  });
  const picks = useRecordPicks({
    ...refs,
    ...draft,
    ...sheets,
    ...places,
    client,
    teamId,
    setTeamId,
    toast,
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
    isEdit,
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
    hydrated: draft.hydrated,
    overlap: slot.overlap,
    timeWarning: slot.timeWarning,
  });
  const guard = useLeaveGuard({
    isEdit,
    hydrated: draft.hydrated,
    buildPatch,
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
    navigation,
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
    menuTitle: client?.full_name?.trim() || (editing ? recordComment(editing) : "") || title,
    setStatus: draft.setStatus,
    editBaselineRef: guard.editBaselineRef,
    leaveBook: guard.leaveBook,
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
    ...look,
    ...refs,
    ...draft,
    ...sheets,
    client,
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
