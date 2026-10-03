import { Fragment, type ReactNode } from "react";
import { Users } from "lucide-react-native";

import { Divider } from "@/components/ui/Divider";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { useMyMemberships } from "@/features/settings/my-memberships";
import { useMyCalendars } from "@/features/settings/workspaces";
import { SmsCabinetRow } from "@/features/sms/SmsCabinetRow";
import { TariffRow } from "@/features/tariffs/TariffRow";

import { AccountScopeProvider, useAccountGate, useAccountName } from "./account-scope";
import { CabinetRequisitesRow } from "./CabinetRequisitesRow";
import { TariffPaymentsRow } from "./TariffPaymentsRow";

// АККАУНТЫ, КОТОРЫЕ ПРИГЛАСИЛИ, — В КАБИНЕТЕ ПАРТНЁРА (владелец 04.10: «там,
// где у нас „Пригласить“, будем закреплены мы как наша компания, и там идут
// все разрешения — вниз опускается то, что мы разрешаем, а всё остальное
// остаётся у этого человека»; «чтобы клиент случайно не перепутал и не
// оплатил что-то своё»).
//
// Под строкой приглашений — по блоку на каждый аккаунт, где человек партнёр:
// шапка — имя аккаунта, первой строкой — его команды, ниже — только то, что
// этот аккаунт открыл правами раздела «Кабинет»: тариф, оплаты тарифа, SMS,
// реквизиты. Нет права — нет строки. Каждая строка открывает страницу ЗА ЭТОТ
// аккаунт (`?tenant=`), а не за тот, что открыт на телефоне, — и платят на
// ней за него.

export function InvitedAccounts() {
  const memberships = useMyMemberships().data ?? [];
  const calendars = useMyCalendars().data ?? [];
  const invited = memberships.filter((m) => m.role !== "owner");
  if (invited.length === 0) return null;
  return (
    <>
      {invited.map((m) => (
        <AccountScopeProvider key={m.tenantId} tenantId={m.tenantId}>
          <InvitedAccountBlock
            tenantId={m.tenantId}
            fallbackName={calendars.find((c) => c.tenantId === m.tenantId)?.tenantName ?? null}
            teamNames={calendars.filter((c) => c.tenantId === m.tenantId).map((c) => c.teamName)}
          />
        </AccountScopeProvider>
      ))}
    </>
  );
}

const seen = (gate: string) => gate === "read" || gate === "write";

function InvitedAccountBlock({
  tenantId,
  fallbackName,
  teamNames,
}: {
  tenantId: string;
  fallbackName: string | null;
  teamNames: string[];
}) {
  const name = useAccountName() ?? fallbackName ?? "Аккаунт";
  const tariff = useAccountGate("cabinet.tariff");
  const payments = useAccountGate("cabinet.tariff_payments");
  const sms = useAccountGate("cabinet.sms");
  const requisites = useAccountGate("finance.settings_requisites");

  const rows: { key: string; node: ReactNode }[] = [];
  if (seen(tariff)) rows.push({ key: "tariff", node: <TariffRow tenantId={tenantId} /> });
  if (seen(payments)) rows.push({ key: "payments", node: <TariffPaymentsRow tenantId={tenantId} /> });
  if (seen(sms)) rows.push({ key: "sms", node: <SmsCabinetRow tenantId={tenantId} /> });
  if (seen(requisites)) rows.push({ key: "requisites", node: <CabinetRequisitesRow tenantId={tenantId} /> });

  return (
    <>
      <SectionEyebrow>{name}</SectionEyebrow>
      <SectionCard>
        {/* Команды этого аккаунта, в которых человек работает, — словами:
            сами они живут в ленте календаря. */}
        <SettingsRow
          tile="neutral"
          icon={Users}
          title="Команды"
          sub={teamNames.length > 0 ? teamNames.join(" · ") : undefined}
        />
        {rows.map((row) => (
          <Fragment key={row.key}>
            <Divider inset={48} />
            {row.node}
          </Fragment>
        ))}
      </SectionCard>
    </>
  );
}
