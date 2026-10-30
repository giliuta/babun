import { SettingsGroup } from "@/components/ui/SettingsGroup";
import { CalendarPartnersRow } from "./CalendarPartnersRow";
import { TariffRow, useSeesTariff } from "@/features/tariffs/TariffRow";
import { usePartnersAccess } from "@/session/use-partner-manager";

/** «Тариф» и «Партнёры» календаря — отдельной карточкой под его временем:
 *  у каждого календаря своя оплата и свои люди, и приглашают прямо в него.
 *  Строки — по правам «Тариф» и «Партнёры»; нет ни одной — нет карточки. */
export function CalendarAccountRows({ teamId }: { teamId: string }) {
  const seesTariff = useSeesTariff();
  const partners = usePartnersAccess().sees;
  return (
    <SettingsGroup
      rows={[
        seesTariff ? <TariffRow key="tariff" teamId={teamId} /> : null,
        partners ? <CalendarPartnersRow key="partners" teamId={teamId} /> : null,
      ]}
    />
  );
}
