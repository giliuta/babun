import { Fragment, type ReactNode } from "react";
import { Users } from "lucide-react-native";

import { Divider } from "@/components/ui/Divider";
import { SectionCard } from "@/components/ui/SectionCard";
import { SectionEyebrow } from "@/components/ui/SectionEyebrow";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { useMirror } from "@/session/mirror-state";
import { useTeams } from "@/features/reference/queries";
import { useMyMemberships } from "@/session/my-memberships";
import { useMyCalendars } from "@/session/workspaces";
import { useTenantId } from "@/lib/tenant";
import { SmsCabinetRow } from "@/features/sms/SmsCabinetRow";

import { AccountScopeProvider, useAccountGate, useAccountName } from "@/session/account-scope";
import { HistoryRow } from "./HistoryRow";
import { SETTINGS_ROW_INSET } from "@/components/ui/tokens";

// АККАУНТЫ, КОТОРЫЕ ПРИГЛАСИЛИ, — В КАБИНЕТЕ ПАРТНЁРА: здесь идут все
// разрешения пригласившего, а всё остальное остаётся у самого человека, чтобы
// он случайно не перепутал и не оплатил что-то своё.
//
// Под строкой приглашений — по блоку на каждый аккаунт, где человек партнёр:
// шапка — имя аккаунта, первой строкой — его команды, ниже — только то, что
// этот аккаунт открыл правами раздела «Кабинет»: SMS и история изменений.
// Нет права — нет строки. Тариф и партнёры — у каждого календаря, в его
// шестерёнке; реквизиты — в шестерёнке «Финансов» у каждого календаря. Каждая строка открывает страницу ЗА ЭТОТ
// аккаунт (`?tenant=`), а не за тот, что открыт на телефоне, — и платят на
// ней за него.

export function InvitedAccounts() {
  const memberships = useMyMemberships().data ?? [];
  const calendars = useMyCalendars().data ?? [];
  const mirror = useMirror();
  const tenantId = useTenantId();
  const teams = useTeams().data ?? [];
  // «ПОСМОТРЕТЬ ЕГО ГЛАЗАМИ» (как это будет выглядеть у мастера): у него этот аккаунт — пригласивший, и блок стоит ровно так, как
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
  const name = useAccountName() ?? fallbackName ?? "Аккаунт";
  const sms = useAccountGate("cabinet.sms");
  const history = useAccountGate("cabinet.history");

  const rows: { key: string; node: ReactNode }[] = [];
  // Тарифа, оплат и реквизитов здесь нет: они у каждого календаря этого
  // аккаунта — тариф в шестерёнке календаря, реквизиты в шестерёнке «Финансов».
  if (seen(sms)) rows.push({ key: "sms", node: <SmsCabinetRow tenantId={tenantId} /> });
  if (seen(history)) rows.push({ key: "history", node: <HistoryRow tenantId={tenantId} /> });
  // Партнёров здесь нет: люди — у каждого календаря, директор приглашает и
  // ставит права в шестерёнке календаря этого аккаунта.

  return (
    <>
      <SectionEyebrow>{name}</SectionEyebrow>
      <SectionCard>
        {/* Команды этого аккаунта, в которых человек работает, — словами:
            сами они живут в ленте календаря. */}
        <SettingsRow
          tile={SETTINGS_TILE.purple}
          icon={Users}
          title="Команды"
          sub={teamNames.length > 0 ? teamNames.join(" · ") : undefined}
        />
        {rows.map((row) => (
          <Fragment key={row.key}>
            <Divider inset={SETTINGS_ROW_INSET} />
            {row.node}
          </Fragment>
        ))}
      </SectionCard>
    </>
  );
}
