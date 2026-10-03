import { useRouter, type Href } from "expo-router";
import { Building2 } from "lucide-react-native";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { useCompanies } from "@/features/companies/queries";
import { requisitesDoorLine } from "@/features/finances/team-settings-lines";
import { useNextInvoiceNumber } from "@/features/invoices/queries";
import { useCurrentRole } from "@/features/settings/tenant";

// «РЕКВИЗИТЫ» — СТРОКА-ДВЕРЬ КАБИНЕТА (владелец 2026-10-03: «запихни
// реквизиты компании в кабинет: это единый блок на все компании, а команды
// уже выписывают»). Наборы реквизитов — одни на весь аккаунт, любая команда
// выставляет документ от любого из них; поэтому им место рядом с тарифом и
// партнёрами, а не в шестерёнке одной команды. Подпись — живое состояние:
// сколько рабочих наборов и номер следующего инвойса основного.
export function CabinetRequisitesRow() {
  const router = useRouter();
  const owner = useCurrentRole().data === "owner";
  const companies = useCompanies();
  // Номер следующего инвойса сервер показывает владельцу и тому, кто сам
  // выставляет инвойсы; партнёр «Реквизитов» видит наборы без номера.
  const nextInvoice = useNextInvoiceNumber(new Date().getFullYear(), undefined, owner).data;
  const liveSets = (companies.data ?? []).filter((c) => !c.archived_at).length;
  return (
    <SettingsRow
      tile={SETTINGS_TILE.green}
      icon={Building2}
      title="Реквизиты"
      sub={companies.data ? requisitesDoorLine(liveSets, nextInvoice ?? null) : undefined}
      onPress={() => router.push("/cabinet/requisites" as Href)}
    />
  );
}
