import { Fragment, type ReactNode } from "react";
import { useRouter, type Href } from "expo-router";
import { Archive, CalendarDays, Download, Users } from "lucide-react-native";

import { Divider } from "@/components/ui/Divider";
import { SectionCard } from "@/components/ui/SectionCard";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import type { AccountKind } from "@/features/settings/my-accounts";
import { useMyCalendars, useSwitchWorkspace } from "@/features/settings/workspaces";
import { SmsCabinetRow } from "@/features/sms/SmsCabinetRow";
import { TariffRow } from "@/features/tariffs/TariffRow";
import { useTenantId } from "@/lib/tenant";
import { notify } from "@/lib/notify";
import { CAN_PAY_HERE } from "@/lib/pay-here";

import { AccountScopeProvider } from "./account-scope";
import { ArchiveRow } from "./ArchiveRow";
import { CabinetRequisitesRow } from "./CabinetRequisitesRow";
import { DataExportRow } from "./DataExportRow";
import { HistoryRow } from "./HistoryRow";
import { TariffPaymentsRow } from "./TariffPaymentsRow";

// СВОЙ АККАУНТ В КАБИНЕТЕ — ЛИЧНОЕ ИЛИ СВОЯ КОМПАНИЯ (владелец 11.10:
// «Кабинет: переключать между Личным и компаниями»). Аккаунт называет
// переключатель над блоком, а не тот, что открыт на телефоне:
//   • тариф, оплаты тарифа, SMS, реквизиты и история — страницы за ЭТОТ
//     аккаунт (`?tenant=`), как блок пригласившего (`InvitedAccounts`);
//   • «Календари», «Партнёры», «Выгрузка данных» и «Архив» — хозяйство
//     аккаунта: телефон сначала переходит в него, страница открывается там.
// У Личного календаря добавить нельзя и партнёров нет (один календарь, без
// приглашений — сервер держит то же), поэтому этих строк у него нет.

export function OwnAccountSection({ tenantId, kind }: { tenantId: string; kind: AccountKind }) {
  const router = useRouter();
  const activeTenant = useTenantId();
  const switchWorkspace = useSwitchWorkspace();
  const calendars = useMyCalendars().data ?? [];
  const here = tenantId === activeTenant;
  const company = kind === "company";

  /** Перевести телефон в этот аккаунт и открыть страницу уже там. */
  const openIn = (href: string) => async () => {
    try {
      if (!here) await switchWorkspace.mutateAsync({ tenantId, onboarded: true, role: "owner" });
      router.push(href as Href);
    } catch (e) {
      notify("Не удалось открыть", (e as Error).message);
    }
  };

  const calendarNames = calendars.filter((c) => c.tenantId === tenantId).map((c) => c.teamName);

  const rows: { key: string; node: ReactNode }[] = [];
  if (company) {
    rows.push({
      key: "calendars",
      node: (
        <SettingsRow
          tile={SETTINGS_TILE.blue}
          icon={CalendarDays}
          title="Календари"
          sub={calendarNames.length > 0 ? calendarNames.join(" · ") : undefined}
          onPress={openIn("/cabinet/calendars")}
        />
      ),
    });
  }
  // ТАРИФ (владелец 01.10: «выбор тарифа — в кабинете»): у Личного — свой,
  // у каждой компании — свой (11.10).
  rows.push({ key: "tariff", node: <TariffRow tenantId={tenantId} /> });
  // Оплаты тарифа — только на сайте: в приложении из магазина покупок нет.
  if (CAN_PAY_HERE) rows.push({ key: "payments", node: <TariffPaymentsRow tenantId={tenantId} /> });
  if (company) {
    rows.push({
      key: "partners",
      node: (
        <SettingsRow
          tile={SETTINGS_TILE.indigo}
          icon={Users}
          title="Партнёры"
          sub="Права по календарям"
          onPress={openIn("/cabinet/people")}
        />
      ),
    });
  }
  rows.push({ key: "requisites", node: <CabinetRequisitesRow tenantId={tenantId} /> });
  rows.push({ key: "history", node: <HistoryRow tenantId={tenantId} /> });
  rows.push({ key: "sms", node: <SmsCabinetRow tenantId={tenantId} /> });
  rows.push({
    key: "export",
    node: here ? (
      <DataExportRow />
    ) : (
      <SettingsRow
        tile={SETTINGS_TILE.blue}
        icon={Download}
        title="Выгрузка данных"
        sub="Клиенты, записи, финансы"
        onPress={openIn("/cabinet/export")}
      />
    ),
  });
  if (company) {
    rows.push({
      key: "archive",
      node: here ? (
        <ArchiveRow />
      ) : (
        <SettingsRow
          tile="neutral"
          icon={Archive}
          title="Архив"
          sub="Удалённые календари"
          onPress={openIn("/cabinet/archive")}
        />
      ),
    });
  }

  return (
    <AccountScopeProvider tenantId={tenantId}>
      <SectionCard>
        {rows.map((row, i) => (
          <Fragment key={row.key}>
            {i > 0 ? <Divider inset={48} /> : null}
            {row.node}
          </Fragment>
        ))}
      </SectionCard>
    </AccountScopeProvider>
  );
}
