import { useEffect, useRef, useState } from "react";
import {
  getCurrentCyprusTime,
  getCurrentTimeInZone,
} from "@babun/shared/common/utils/date-utils";
import { EMPTY_FILTER, type ClientsFilter } from "@/features/clients/filter";
import { loadDayFilter, saveDayFilter } from "@/features/clients/filter-pref";
import { useCalendarSettings } from "@/features/settings/local-settings";
import { useBusinessToday } from "@/features/settings/business-today";

/** Search, the day's filter set, which sheet is open and the bulk pick. */
export function useListUiState(params: { openImport?: string; openContacts?: string }) {
  const [query, setQuery] = useState("");
  // Набор живёт до конца дня: звонок/SMS выбрасывают из приложения, и
  // собирать шесть условий заново каждый круг обзвона — потеря времени.
  // Пресетный период набора — по часам компании, как у «Финансов».
  const timezone = useCalendarSettings().data?.timezone;
  const today = useBusinessToday();
  const [filter, setFilter] = useState<ClientsFilter>(
    () =>
      loadDayFilter(
        timezone ? getCurrentTimeInZone(timezone) : getCurrentCyprusTime(),
        today,
      ) ?? EMPTY_FILTER,
  );
  // ПОЛНОЧЬ ПРИ ОТКРЫТОМ СПИСКЕ: набор — дневной, и новый день его не
  // наследует. Без сброса вчерашний набор сохранялся бы под новой датой, а
  // «Сегодня» в нём показывало бы вчера.
  const filterDay = useRef(today);
  useEffect(() => {
    if (filterDay.current !== today) {
      filterDay.current = today;
      setFilter(EMPTY_FILTER);
      return;
    }
    saveDayFilter(filter, today);
  }, [filter, today]);
  const [sheetOpen, setSheetOpen] = useState(false);
  // С какого измерения открыть лист (тап по телу токена в баре).
  const [initialFacet, setInitialFacet] = useState<
    "segment" | "city" | "tag" | "team" | "source" | "property" | null
  >(null);
  const [importOpen, setImportOpen] = useState(false);
  const [contactsOpen, setContactsOpen] = useState(false);

  // ── Bulk-mode (multi-select) ──────────────────────────────────────
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [smsOpen, setSmsOpen] = useState(false);

  useEffect(() => {
    if (params.openContacts) setContactsOpen(true);
    if (params.openImport) setImportOpen(true);
  }, [params.openImport, params.openContacts]);
  return {
    query,
    setQuery,
    filter,
    setFilter,
    sheetOpen,
    setSheetOpen,
    initialFacet,
    setInitialFacet,
    importOpen,
    setImportOpen,
    contactsOpen,
    setContactsOpen,
    selecting,
    setSelecting,
    selectedIds,
    setSelectedIds,
    smsOpen,
    setSmsOpen,
  };
}
