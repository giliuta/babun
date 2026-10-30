import { useRouter, type Href } from "expo-router";
import { Building2 } from "lucide-react-native";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { useNextInvoiceNumber } from "@/features/finances/invoices-queries";
import { useTeams } from "@/features/reference/queries";
import { useBusinessToday } from "@/features/settings/business-today";
import { useCurrentRole } from "@/session/tenant";
import { teamCompanyId } from "./company-calendars";
import { useCompanies } from "./queries";

// «РЕКВИЗИТЫ» — СТРОКА ШЕСТЕРЁНКИ «ФИНАНСОВ» У ВЫБРАННОГО КАЛЕНДАРЯ. Наборы
// одни на аккаунт, а строка говорит, от чьего имени ЭТОТ календарь
// выставляет инвойсы и чеки: «Основные · INV-2026-0001». Ведёт на страницу
// наборов, где у каждого набора — его календари.
export function RequisitesRow({ teamId }: { teamId: string }) {
  const router = useRouter();
  const companies = useCompanies();
  const team = (useTeams({ display: true }).data ?? []).find((x) => x.id === teamId);
  const setId = team ? teamCompanyId(team, companies.data ?? []) : null;
  const set = (companies.data ?? []).find((c) => c.id === setId) ?? null;
  // Номер следующего инвойса сервер показывает владельцу; партнёр с
  // «Видит» видит набор своего календаря без номера. Год — компании, а не
  // телефона (сервер нумерует по `tenant_business_date`).
  const owner = useCurrentRole().data === "owner";
  const businessYear = Number(useBusinessToday().slice(0, 4));
  const next = useNextInvoiceNumber(businessYear, setId, owner && !!setId).data;
  const sub = !companies.data ? undefined : !set ? "Пока нет" : owner && next ? `${set.name} · ${next}` : set.name;
  return (
    <SettingsRow
      tile={SETTINGS_TILE.green}
      icon={Building2}
      title="Реквизиты"
      sub={sub}
      onPress={() => router.push(`/finances/requisites?team=${encodeURIComponent(teamId)}` as Href)}
    />
  );
}
