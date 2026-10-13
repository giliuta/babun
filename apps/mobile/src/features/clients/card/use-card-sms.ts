import { useMemo } from "react";
import type { Client } from "@babun/shared/local/clients";
import type { Appointment } from "@babun/shared/local/appointments";
import { buildStats } from "@babun/shared/local/selectors/client-stats";
import { useBusinessNow } from "@/features/appointments/business-now";
import type { CardAccess } from "@/features/clients/card-access";
import type { ClientsScope } from "@/session/clients-company";
import { useTeams } from "@/features/reference/queries";
import { useTenant } from "@/session/tenant";
import { clientSmsVars } from "@/features/sms/client-sms-vars";

/** The card's shared stats and the SMS context its phone numbers offer. */
export function useCardSms({
  c,
  appointments,
  scope,
  access,
}: {
  c: Client | undefined;
  appointments: Appointment[];
  scope: ClientsScope | null;
  access: CardAccess;
}) {
  // Shared selectors — memoized so unrelated state changes don't re-scan
  // every appointment. Hooks must run unconditionally, hence the guards
  // before the early returns of `ClientDetailScreen`.
  const stats = useMemo(
    () => (c ? buildStats(c, appointments) : undefined),
    [c, appointments],
  );

  // ШАБЛОНЫ SMS ИЗ КАРТОЧКИ (STORY-089): имя, долг и ближайшая запись
  // клиента — «SMS» у его номера предложит шаблоны, которые ими заполняются.
  const { data: smsTeams = [] } = useTeams({ includeInactive: true });
  // Имя в шаблоне — компании КАРТОЧКИ (03.10): при команде партнёра в
  // календаре клиент AirFix получал бы подпись чужой компании.
  const activeCompanyName = useTenant().data?.name ?? null;
  const companyName = scope
    ? (scope.tenantName ?? (scope.isActive ? activeCompanyName : null))
    : activeCompanyName;
  // «Ближайшая запись» в SMS — по часам команды клиента, а не телефона.
  const smsNow = useBusinessNow(c?.team_id ?? null);
  const clientSmsContext = useMemo(() => {
    if (!c) return null;
    const now = smsNow();
    return {
      clientId: c.id,
      optOut: c.sms_opt_out === true,
      tenantId: scope?.tenantId ?? null,
      // Команда клиента — от неё SMS по умолчанию, если у неё есть имя
      // отправителя (так и задумано в листе: «без записи — команда клиента»).
      teamId: c.team_id ?? null,
      vars: clientSmsVars({
        client: c,
        appointments,
        teams: smsTeams,
        company: companyName,
        debt: access.money.show ? (stats?.debt ?? 0) : null,
        showMoney: access.money.show,
        today: now.ymd,
        nowHm: now.hm,
      }),
    };
  }, [appointments, c, access.money.show, companyName, smsTeams, stats?.debt, smsNow, scope?.tenantId]);
  return { stats, clientSmsContext };
}
