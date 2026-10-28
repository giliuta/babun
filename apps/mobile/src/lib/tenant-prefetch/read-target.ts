// ЧТЕНИЕ ОДНОЙ ЦЕЛИ ПРОГРЕВА — тем же путём, что и хук экрана, клиентом,
// привязанным к компании. Правила прогрева и сторож побочных действий — в
// `../tenant-prefetch.ts`; сторож читает этот файл вместе с ним.

import {
  listAppointments as repoListAppointments,
} from "@babun/shared/db/repositories/appointments";
import {
  listClientTags as repoListClientTags,
  listClients as repoListClients,
} from "@babun/shared/db/repositories/clients";
import { listScheduleEntries } from "@babun/shared/db/repositories/schedule";
import { listDayExtras } from "@babun/shared/db/repositories/day-extras";
import { listDayCities } from "@babun/shared/db/repositories/day-cities";
import {
  listAccountBalances,
  listRefundTotals,
  listTransactionsForRange,
} from "@babun/shared/db/repositories/finance-transactions";
import { listFinanceCategories } from "@babun/shared/db/repositories/finance-categories";
import { listAccounts } from "@babun/shared/db/repositories/accounts";
import { listInvoices } from "@babun/shared/db/repositories/invoices";
import { listInvoicePayments } from "@babun/shared/db/repositories/invoice-payments";
import { listDebtPaidTotals, listDebts } from "@babun/shared/db/repositories/debts";
import { supabase } from "@/lib/supabase";
import { tenantBoundClient } from "@/lib/tenant-bound-client";
import type { WarmCompany, WarmTarget } from "@/lib/tenant-prefetch-plan";
import type { UserRole } from "@/session/role-policy";
import {
  fetchCalendarSettings,
  fetchTenantProfile,
} from "@/session/company-fetchers";
import {
  fetchCities,
  fetchMasters,
  fetchTeams,
} from "@/features/reference/queries";
import { fetchServices } from "@/features/services/queries";
import { listMasterAppointmentsSafePaged } from "@/features/calendar/master-appointments";
import { listMasterClientsSafe } from "@/features/clients/queries";

type Client = typeof supabase;

export interface CompanyContext {
  tenantId: string;
  role: UserRole;
  client: Client;
}

export function companyContext({ tenantId, role }: WarmCompany): CompanyContext {
  return { tenantId, role, client: tenantBoundClient(tenantId) };
}

/** Чтение одной цели — ровно тем же путём, что и хук экрана, но клиентом,
 *  привязанным к компании, и без побочных действий. Исчерпывающий `switch`:
 *  новый вид цели без чтения не пройдёт проверку типов. */
export function readTarget(ctx: CompanyContext, target: WarmTarget): Promise<unknown> {
  const { tenantId, role, client } = ctx;
  switch (target.kind) {
    case "tenant":
      return fetchTenantProfile(client, tenantId, role);
    case "calendar-settings":
      return fetchCalendarSettings(client, tenantId, role);
    case "teams-all":
      return fetchTeams(client, tenantId, role, true);
    case "appointments":
      return role === "master"
        ? listMasterAppointmentsSafePaged(client)
        : repoListAppointments(client, tenantId);
    case "services-all":
      return fetchServices(client, tenantId, role, { archived: true });
    case "cities":
      return fetchCities(client, tenantId, false, null);
    case "day-cities":
      return listDayCities(client, tenantId);
    case "team-schedules-all":
      return listScheduleEntries(client, tenantId);
    case "day-extras":
      return listDayExtras(client, tenantId);
    case "clients":
      return role === "master"
        ? listMasterClientsSafe(client)
        : repoListClients(client, tenantId);
    case "client-tags":
      return role === "master"
        ? Promise.resolve([])
        : repoListClientTags(client, tenantId);
    case "masters":
      return fetchMasters(client, tenantId, role, false);
    case "masters-all":
      return fetchMasters(client, tenantId, role, true);
    case "finance-categories":
      return listFinanceCategories(client, tenantId);
    case "transactions":
      return listTransactionsForRange(
        client,
        tenantId,
        target.from as string,
        target.to as string,
      );
    case "refund-totals":
      return listRefundTotals(client, tenantId);
    // Долги — всей компанией, без `teamId`: хук читает тот же срез и отбирает
    // команду на устройстве (`pickTeamDebts`), так что один прогретый ответ
    // годится для любого чипа.
    case "debts":
      return listDebts(client, tenantId, target.from as string, target.to as string);
    case "debt-paid-totals":
      return listDebtPaidTotals(client, tenantId);
    case "invoices":
      return listInvoices(client, tenantId, {});
    case "invoice-payments":
      return listInvoicePayments(client, tenantId);
    case "account-rows":
      return listAccounts(client, tenantId, { includeInactive: false });
    case "account-balances":
      return listAccountBalances(client, tenantId);
    default: {
      const unreachable: never = target.kind;
      throw new Error(`Прогрев не знает цели «${String(unreachable)}»`);
    }
  }
}
