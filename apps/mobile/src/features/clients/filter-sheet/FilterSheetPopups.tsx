import {
  PeriodPresetModal,
  PeriodWheelsModal,
} from "@/features/finances/PeriodSheets";
import type { ClientsFilter } from "../filter";

/** Попапы листа «Фильтры» — только период: его пресеты и колёса — общие
 *  листы «Финансов». Фасеты и сортировка раскрываются под своей строкой
 *  (`InlinePick.tsx`), шторкой поверх листа не открываются. */
export function FilterSheetPopups({
  presetsOpen,
  setPresetsOpen,
  wheelsOpen,
  setWheelsOpen,
  filter,
  now,
  allSpanDates,
  draftFrom,
  draftTo,
  applyFilter,
}: {
  presetsOpen: boolean;
  setPresetsOpen: (open: boolean) => void;
  wheelsOpen: boolean;
  setWheelsOpen: (open: boolean) => void;
  filter: ClientsFilter;
  now: Date;
  allSpanDates: string | null;
  draftFrom: string;
  draftTo: string;
  applyFilter: (next: ClientsFilter) => void;
}) {
  return (
    <>
      <PeriodPresetModal
        visible={presetsOpen}
        current={filter.period}
        businessNow={now}
        allTime={{
          active: !filter.period,
          hint: allSpanDates ?? undefined,
          onSelect: () => applyFilter({ ...filter, period: null }),
        }}
        onClose={() => setPresetsOpen(false)}
        onApply={(p) => applyFilter({ ...filter, period: p })}
      />
      <PeriodWheelsModal
        visible={wheelsOpen}
        current={{
          preset: filter.period?.preset ?? "custom",
          from: draftFrom,
          to: draftTo,
        }}
        onClose={() => setWheelsOpen(false)}
        onApply={(p) => applyFilter({ ...filter, period: p })}
      />
    </>
  );
}
