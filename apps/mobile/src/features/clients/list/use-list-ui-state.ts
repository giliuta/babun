import { useEffect, useState } from "react";
import { EMPTY_FILTER, type ClientsFilter } from "@/features/clients/filter";
import { loadDayFilter, saveDayFilter } from "@/features/clients/filter-pref";

/** Search, the day's filter set, which sheet is open and the bulk pick. */
export function useListUiState(params: { openImport?: string; openContacts?: string }) {
  const [query, setQuery] = useState("");
  // Набор живёт до конца дня: звонок/SMS выбрасывают из приложения, и
  // собирать шесть условий заново каждый круг обзвона — потеря времени.
  const [filter, setFilter] = useState<ClientsFilter>(
    () => loadDayFilter() ?? EMPTY_FILTER,
  );
  useEffect(() => {
    saveDayFilter(filter);
  }, [filter]);
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
