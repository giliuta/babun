import { useEffect, useLayoutEffect, type ReactNode } from "react";
import { clearOverlay, setOverlay } from "@/components/ui/sheet-overlay";

/** Слои листа-накладки уходят в окно листа под ним (`SheetOverlayOutlet`). */
export function OverlayLayers({
  target,
  layers,
  onBack,
}: {
  target: string;
  layers: ReactNode;
  /** «Назад» Android на этой накладке закрывает её, а не лист под ней. */
  onBack: () => void;
}) {
  useLayoutEffect(() => {
    setOverlay(target, layers, onBack);
  });
  useEffect(() => () => clearOverlay(target), [target]);
  return null;
}
