import { useState } from "react";
import { defaultPeriod } from "@/lib/period";
import { useBusinessPeriod } from "../use-business-period";
import type { BusinessClock } from "./use-business-clock";

/** Selected period of the screen plus the open-state of its two pickers. */
export function useHomePeriod(clock: BusinessClock) {
  // Пресет живёт по календарю компании (`use-business-period.ts`).
  const [period, setPeriod] = useBusinessPeriod(clock, defaultPeriod);
  const [presetOpen, setPresetOpen] = useState(false);
  const [wheelsOpen, setWheelsOpen] = useState(false);
  return { period, setPeriod, presetOpen, setPresetOpen, wheelsOpen, setWheelsOpen };
}
