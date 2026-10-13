import { useMemo } from "react";
import { useTenantId } from "@/lib/tenant";
import { useCalendarVisibility } from "@/session/workspaces";
import { useMasters, useTeams } from "@/features/reference/queries";
import { useAllServices } from "@/features/services/queries";
import { useAppointments } from "@/features/calendar/queries";
import { useClients } from "@/features/clients/queries";
import { useInvoicePayments, useInvoices } from "@/features/finances/invoices-queries";
import { useAccountsWithBalances } from "../accounts";
import { useFinanceCategories } from "../queries";

/** Reference data of the screen: every company-wide read that does not depend
 *  on the period or the chip, plus their stable `?? []` views. */
export function useHomeReferences() {
  const categoriesQuery = useFinanceCategories();
  const teamsQuery = useTeams();
  // Активные — для чипов скоупа; ВСЕ (вкл. удалённые) — для подписей
  // истории: лента/попап/CSV не должны терять имя расформированной команды.
  const allTeamsQuery = useTeams({ includeInactive: true });
  // Финансы считают СЛУЧИВШЕЕСЯ: расход материалов прошлой записи не
  // имеет права обнулиться от того, что услугу убрали из прайса.
  const servicesQuery = useAllServices();
  const appointmentsQuery = useAppointments();
  const clientsQuery = useClients();
  const invoicesQuery = useInvoices();
  const invoicePaymentsQuery = useInvoicePayments();
  const accountsQuery = useAccountsWithBalances();
  // Лист перевода — со СКРЫТЫМИ счетами (владелец 03.10: «в конце месяца
  // переводить на накопительный»); плитки и панель «Счета» их не знают.
  const transferAccountsQuery = useAccountsWithBalances({ includeHidden: true });
  // С закрытыми — только ради имён в строках ленты: операция периода могла
  // пройти через счёт, который с тех пор закрыли.
  // ПОДПИСИ ИСТОРИИ — СО СКРЫТЫМИ И УДАЛЁННЫМИ: имя и команда счёта у
  // прошлой операции не пропадают, когда счёт ушёл в «Удалённые счета».
  const allAccountsQuery = useAccountsWithBalances({ includeInactive: true, includeDeleted: true });
  const categories = useMemo(
    () => categoriesQuery.data ?? [],
    [categoriesQuery.data],
  );
  // Скрытого календаря (владелец 04.10) в ленте и выборе разреза нет; деньги
  // его счетов при этом никуда не деваются.
  // `isHidden` is a plain callback (no `this`), safe to destructure.
  const { isHidden } = useCalendarVisibility();
  const visibilityTenantId = useTenantId();
  const teams = useMemo(
    () =>
      (teamsQuery.data ?? []).filter(
        (team) => !isHidden(visibilityTenantId, team.id),
      ),
    [teamsQuery.data, isHidden, visibilityTenantId],
  );
  const allTeams = useMemo(
    () => allTeamsQuery.data ?? [],
    [allTeamsQuery.data],
  );
  const services = useMemo(
    () => servicesQuery.data ?? [],
    [servicesQuery.data],
  );
  const appts = useMemo(
    () => appointmentsQuery.data ?? [],
    [appointmentsQuery.data],
  );
  const clients = useMemo(
    () => clientsQuery.data ?? [],
    [clientsQuery.data],
  );
  const invoices = useMemo(
    () => invoicesQuery.data ?? [],
    [invoicesQuery.data],
  );
  const invoicePayments = useMemo(
    () => invoicePaymentsQuery.data ?? {},
    [invoicePaymentsQuery.data],
  );
  const accounts = useMemo(
    () => accountsQuery.data ?? [],
    [accountsQuery.data],
  );
  const allAccounts = useMemo(
    () => allAccountsQuery.data ?? accounts,
    [allAccountsQuery.data, accounts],
  );
  // Счета без команды — сироты старой схемы общего счёта. Ни с одним чипом
  // команды они не совпадают, а чипа «Все» на экране нет — без своего чипа их
  // деньги были бы невидимы на вкладке ЦЕЛИКОМ: «ДЕНЬГИ БЕЗ ХОЗЯИНА ВСЁ РАВНО
  // ВИДНЫ».
  const orphanAccounts = useMemo(
    () => accounts.filter((account) => !account.brigade_id),
    [accounts],
  );
  const hasOrphanAccounts = orphanAccounts.length > 0;
  // Команда каждого счёта, включая закрытые: строка журнала без команды встаёт
  // под команду своего счёта (`team-scope.ts`).
  const accountTeam = useMemo(
    () =>
      new Map(
        allAccounts.map((account) => [account.id, account.brigade_id ?? null] as const),
      ),
    [allAccounts],
  );
  // `accountsQuery.data !== undefined` — счета доехали (у хука нет isSuccess:
  // data undefined, пока не пришли обе половины — строки и остатки).
  const accountsLoaded = accountsQuery.data !== undefined;
  // Листу перевода нужны сами команды, а не их имена: он подписывает счета
  // командами, и расформированная команда обязана остаться названной.
  const teamByIdAll = useMemo(
    () => new Map(allTeams.map((tm) => [tm.id, tm])),
    [allTeams],
  );
  // Сотрудники — получатель выплаты зарплаты в строках и разборе
  // («Зарплата · Даня», `category-asks.ts`). С уволенными: старая выплата не должна
  // терять имя.
  const peopleData = useMasters({ includeInactive: true }).data;
  const people = useMemo(() => peopleData ?? [], [peopleData]);
  return {
    categoriesQuery,
    teamsQuery,
    servicesQuery,
    appointmentsQuery,
    clientsQuery,
    invoicesQuery,
    invoicePaymentsQuery,
    accountsQuery,
    transferAccountsQuery,
    categories,
    teams,
    allTeams,
    services,
    appts,
    clients,
    invoices,
    invoicePayments,
    accounts,
    allAccounts,
    orphanAccounts,
    hasOrphanAccounts,
    accountTeam,
    accountsLoaded,
    teamByIdAll,
    people,
  };
}

export type HomeReferences = ReturnType<typeof useHomeReferences>;
