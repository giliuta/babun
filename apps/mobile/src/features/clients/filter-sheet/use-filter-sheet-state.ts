import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { haptics } from "@/lib/haptics";
import { resetFilters, type ClientsFilter } from "../filter";
import type { FacetSheet } from "./facet-config";

/** Which popup of the sheet is open, plus the «Сбросить / Вернуть» window. */
export function useFilterSheetState(visible: boolean, initialFacet: FacetSheet | null | undefined) {
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [wheelsOpen, setWheelsOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [openFacet, setOpenFacet] = useState<FacetSheet | null>(null);

  // «Сбросить» с прощением: снятый набор (вместе с запросом поиска) можно
  // вернуть, пока лист открыт и пока набор не тронут заново. Таймера НЕТ:
  // немой обрыв через N секунд — худший вариант, особенно для VoiceOver.
  const [undo, setUndo] = useState<{
    filter: ClientsFilter;
    search: string;
  } | null>(null);

  // Попап под токеном открываем ЧЕРЕЗ КАДР после входной пружины листа —
  // иначе две пружины стартуют одновременно и обе смазываются.
  useEffect(() => {
    if (!visible || !initialFacet) return;
    const id = setTimeout(() => setOpenFacet(initialFacet), 260);
    return () => clearTimeout(id);
  }, [visible, initialFacet]);

  useEffect(() => {
    if (!visible) {
      setPresetsOpen(false);
      setWheelsOpen(false);
      setSortOpen(false);
      setOpenFacet(null);
      setUndo(null);
    }
  }, [visible]);

  return {
    presetsOpen,
    setPresetsOpen,
    wheelsOpen,
    setWheelsOpen,
    sortOpen,
    setSortOpen,
    openFacet,
    setOpenFacet,
    undo,
    setUndo,
  };
}

/** Live-apply нем для VoiceOver — дебаунс-анонс счётчика. На открытии
 *  листа не стреляем: там и так читается заголовок. */
export function useCountAnnouncement(visible: boolean, shownCount: number, countPart: string) {
  const announcedOnce = useRef(false);
  useEffect(() => {
    if (!visible) {
      announcedOnce.current = false;
      return;
    }
    if (!announcedOnce.current) {
      announcedOnce.current = true;
      return;
    }
    const id = setTimeout(
      () =>
        AccessibilityInfo.announceForAccessibility(
          shownCount === 0 ? "Ничего не найдено" : `Найдено ${countPart}`,
        ),
      500,
    );
    return () => clearTimeout(id);
  }, [visible, shownCount, countPart]);
}

/** Apply and reset with the undo window. Plain closures, rebuilt per render
 *  like before. */
export function filterSheetActions({
  filter,
  search,
  nothingActive,
  undo,
  setUndo,
  onChange,
  onClearSearch,
}: {
  filter: ClientsFilter;
  search: string;
  nothingActive: boolean;
  undo: { filter: ClientsFilter; search: string } | null;
  setUndo: (next: { filter: ClientsFilter; search: string } | null) => void;
  onChange: (f: ClientsFilter) => void;
  onClearSearch: (next: string) => void;
}) {
  // Любая правка фильтра гасит окно «Вернуть»: иначе кнопка залипала и
  // молча выбрасывала только что собранный набор (владелец жал «Вернуть»
  // и терял выбор).
  const applyFilter = (next: ClientsFilter) => {
    if (undo) setUndo(null);
    onChange(next);
  };

  const onReset = () => {
    if (undo) {
      haptics.success();
      onChange(undo.filter);
      onClearSearch(undo.search);
      setUndo(null);
      AccessibilityInfo.announceForAccessibility("Фильтры возвращены");
      return;
    }
    if (nothingActive) return;
    haptics.tap();
    setUndo({ filter, search });
    onChange(resetFilters());
    onClearSearch("");
    AccessibilityInfo.announceForAccessibility(
      "Фильтры сброшены. Кнопка справа вверху вернёт их",
    );
  };

  return { applyFilter, onReset };
}
