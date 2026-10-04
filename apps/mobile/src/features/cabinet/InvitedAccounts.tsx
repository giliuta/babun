import { Fragment, type ReactNode } from "react";
import { UserCog, Users } from "lucide-react-native";
import { useRouter, type Href } from "expo-router";

import { Divider } from "@/components/ui/Divider";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { useMirror } from "@/features/access/mirror/mirror-state";
import { useTeams } from "@/features/reference/queries";
import { useMyMemberships } from "@/features/settings/my-memberships";
import { useMyCalendars, useSwitchWorkspace } from "@/features/settings/workspaces";
import { notify } from "@/lib/notify";
import { useTenantId } from "@/lib/tenant";
import { SmsCabinetRow } from "@/features/sms/SmsCabinetRow";
import { TariffRow } from "@/features/tariffs/TariffRow";

import { AccountScopeProvider, useAccountGate, useAccountName } from "./account-scope";
import { CabinetRequisitesRow } from "./CabinetRequisitesRow";
import { HistoryRow } from "./HistoryRow";
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
// реквизиты, история изменений, партнёры (04.10). Нет права — нет строки.
// «Партнёры» (директор) открываются В ЭТОМ аккаунте: телефон сначала
// переходит в него — страницы партнёров живут в открытом аккаунте. Каждая строка открывает страницу ЗА ЭТОТ
// аккаунт (`?tenant=`), а не за тот, что открыт на телефоне, — и платят на
// ней за него.

export function InvitedAccounts() {
  const memberships = useMyMemberships().data ?? [];
  const calendars = useMyCalendars().data ?? [];
  const mirror = useMirror();
  const tenantId = useTenantId();
  const teams = useTeams().data ?? [];
  // «ПОСМОТРЕТЬ ЕГО ГЛАЗАМИ» (владелец 04.10: «как это будет выглядеть у
  // мастера»): у него этот аккаунт — пригласивший, и блок стоит ровно так, как
  // у него: его команды и строки по его правам (карта зеркала).
  if (mirror && tenantId) {
    const attached = new Set(mirror.map.attachedCalendars);
    return (
      <AccountScopeProvider tenantId={tenantId}>
        <InvitedAccountBlock
          tenantId={tenantId}
          mirrored
          fallbackName={null}
          teamNames={teams.filter((team) => attached.has(team.id)).map((team) => team.name)}
        />
      </AccountScopeProvider>
    );
  }
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
  mirrored = false,
}: {
  tenantId: string;
  fallbackName: string | null;
  teamNames: string[];
  /** «Посмотреть его глазами»: строки — картинка, переходов нет. */
  mirrored?: boolean;
}) {
  const router = useRouter();
  const activeTenant = useTenantId();
  const memberships = useMyMemberships().data ?? [];
  const switchWorkspace = useSwitchWorkspace();
  const name = useAccountName() ?? fallbackName ?? "Аккаунт";
  const tariff = useAccountGate("cabinet.tariff");
  const payments = useAccountGate("cabinet.tariff_payments");
  const sms = useAccountGate("cabinet.sms");
  const requisites = useAccountGate("finance.settings_requisites");
  const history = useAccountGate("cabinet.history");
  const partners = useAccountGate("company.partners");

  const rows: { key: string; node: ReactNode }[] = [];
  if (seen(tariff)) rows.push({ key: "tariff", node: <TariffRow tenantId={tenantId} /> });
  if (seen(payments)) rows.push({ key: "payments", node: <TariffPaymentsRow tenantId={tenantId} /> });
  if (seen(sms)) rows.push({ key: "sms", node: <SmsCabinetRow tenantId={tenantId} /> });
  if (seen(requisites)) rows.push({ key: "requisites", node: <CabinetRequisitesRow tenantId={tenantId} /> });
  if (seen(history)) rows.push({ key: "history", node: <HistoryRow tenantId={tenantId} /> });
  if (seen(partners)) {
    const openPartners = async () => {
      try {
        if (activeTenant !== tenantId) {
          const role = memberships.find((m) => m.tenantId === tenantId)?.role;
          await switchWorkspace.mutateAsync({
            tenantId,
            onboarded: true,
            role: role === "dispatcher" ? "dispatcher" : "master",
          });
        }
        router.push("/cabinet/people" as Href);
      } catch (e) {
        notify("Не удалось открыть", (e as Error).message);
      }
    };
    rows.push({
      key: "partners",
      node: (
        <SettingsRow
          tile={SETTINGS_TILE.indigo}
          icon={UserCog}
          title="Партнёры"
          sub={partners === "write" ? "Приглашает и ставит права" : "Только видит"}
          onPress={mirrored ? undefined : () => void openPartners()}
        />
      ),
    });
  }

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
