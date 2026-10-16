import { useRouter, type Href } from "expo-router";
import { Building2 } from "lucide-react-native";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { useCompanies } from "@/features/companies/queries";
import { requisitesDoorLine } from "@/features/finances/team-settings-lines";
import { useNextInvoiceNumber } from "@/features/finances/invoices-queries";
import { useCurrentRole } from "@/session/tenant";
import { useAccountScope } from "@/session/account-scope";
import { accountHref } from "@/session/CabinetAccountRoute";

// «РЕКВИЗИТЫ» — СТРОКА-ДВЕРЬ КАБИНЕТА. Наборы реквизитов — одни на весь аккаунт, любая команда
// выставляет документ от любого из них; поэтому им место рядом с тарифом и
// партнёрами, а не в шестерёнке одной команды. Подпись — живое состояние:
// сколько рабочих наборов и номер следующего инвойса основного. `tenantId` —
// строка блока аккаунта, который пригласил: его наборы, без номера.
export function CabinetRequisitesRow({ tenantId }: { tenantId?: string } = {}) {
  const router = useRouter();
  const scope = useAccountScope();
  const owner = useCurrentRole().data === "owner" && !scope.foreign;
  const companies = useCompanies();
  // Номер следующего инвойса сервер показывает владельцу и тому, кто сам
  // выставляет инвойсы; партнёр «Реквизитов» видит наборы без номера.
  // Выключенный запрос всё равно отдаёт номер из кэша владельца — в «его
  // глазами» партнёр видел бы чужое: номер — только владельцу.
  const ownNumber = useNextInvoiceNumber(new Date().getFullYear(), undefined, owner).data;
  const nextInvoice = owner ? ownNumber : null;
  const liveSets = (companies.data ?? []).filter((c) => !c.archived_at).length;
  return (
    <SettingsRow
      tile={SETTINGS_TILE.green}
      icon={Building2}
      title="Реквизиты"
      sub={companies.data ? requisitesDoorLine(liveSets, nextInvoice ?? null) : undefined}
      onPress={() => router.push((tenantId ? accountHref("/cabinet/requisites", tenantId) : "/cabinet/requisites") as Href)}
    />
  );
}
