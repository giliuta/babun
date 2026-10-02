import { useMemo } from "react";
import type { Appointment } from "@babun/shared/local/appointments";
import {
  COLOR_SITUATIONS,
  autoBaseColor,
  recordFilled,
  resolveRecordColor,
  serviceBaseColor,
  type ColorSituation,
} from "@/features/appointments/record-color";
import {
  useAutoColorRule,
  useBookingBlocks,
  useFallbackColor,
  useSituationPalette,
} from "@/features/appointments/booking-prefs";
import { useCities } from "@/features/reference/queries";
import { useAllServices } from "@/features/services/queries";

// ЦВЕТ ЗАПИСИ В ИСТОРИИ КЛИЕНТА — ТОТ ЖЕ, ЧТО У БЛОКА В КАЛЕНДАРЕ (владелец
// 03.10: «иконка цветом этой записи»). Правило одно на продукт
// (`record-color`): рука человека, потом первая незакрытая дыра из палитры
// команды, потом «обычный» цвет по настройке — команды, метки или услуги.
// Настройки — команды самой записи; справочники уже тёплые (календарь грузит
// те же ключи), поэтому сети это не прибавляет.

export function useRecordColor(
  a: Appointment,
  teamColor: string | null | undefined,
  today: string,
): string | null {
  const teamId = a.team_id ?? null;
  const rule = useAutoColorRule(teamId);
  const palette = useSituationPalette(teamId);
  const fallback = useFallbackColor(teamId);
  const blocks = useBookingBlocks(teamId);
  const { data: cities = [] } = useCities({ teamId });
  const { data: services = [] } = useAllServices();
  const serviceColorById = useMemo(
    () => new Map(services.map((s) => [s.id, s.color])),
    [services],
  );
  const active = useMemo<ColorSituation[]>(
    () =>
      // Подсветка — только у включённых блоков записи (владелец 25.09).
      COLOR_SITUATIONS.map((s) => s.id).filter((id) =>
        id === "noObject" ? blocks.includes("object") : blocks.includes("payment"),
      ),
    [blocks],
  );
  const labelName = (a.city ?? "").trim();
  const base = autoBaseColor(rule, {
    team: teamColor,
    label: labelName ? cities.find((c) => c.name === labelName)?.color : null,
    service: serviceBaseColor(a, (id) => serviceColorById.get(id)),
  });
  if (a.kind && a.kind !== "work") return a.color_override ?? base ?? null;
  return resolveRecordColor({
    override: a.color_override,
    filled: recordFilled(a, today),
    base,
    palette,
    active,
    fallback,
  });
}
