import { useEffect, useLayoutEffect, type ReactNode } from "react";
import { clearOverlay, setOverlay } from "@/components/ui/sheet-overlay";

/** Слои листа-накладки уходят в окно листа под ним (`SheetOverlayOutlet`). */
export function OverlayLayers({ target, layers }: { target: string; layers: ReactNode }) {
  useLayoutEffect(() => {
    setOverlay(target, layers);
  });
  useEffect(() => () => clearOverlay(target), [target]);
  return null;
}
