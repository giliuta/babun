import { NO_TEAM } from "./accounts-sections";

// ДЕНЬГИ БЕЗ КОМАНДЫ ВСЁ РАВНО ЧЬИ-ТО (находки 2026-09-15).
//
// «Финансы» режут всё по чипу команды, а чипа «Все» нет. Строка без команды
// поэтому не попадала ни под один чип и пропадала с вкладки целиком:
//   • у Giliuta три строки журнала без команды лежат на счёте «Revolut
//     Business» Команды 1 — остаток счёта их учитывал, а лента счёта нет;
//   • ручной долг, заведённый под «Без команды», писался с пустой командой и
//     больше не показывался нигде;
//   • на «Без команды» плитка «Долги» не брала ни одной записи, а лента под
//     ней брала все записи компании — две витрины об одних деньгах спорили.
//
// Правило одно на экран:
//   • строка с командой — под своей командой;
//   • строка без команды, но на счёте команды — под командой СЧЁТА: деньги
//     лежат там, где лежит счёт;
//   • строка без команды и без командного счёта (счёт-сирота, счёта нет) — под
//     «Без команды». Этот чип живёт, пока такие деньги есть.

/** Попадает ли строка с этой командой под чип. Чипа нет — вся компания. */
export function inTeamScope(
  teamId: string | null | undefined,
  scope: string | null | undefined,
): boolean {
  if (!scope) return true;
  if (scope === NO_TEAM) return teamId == null;
  return teamId === scope;
}

/** Строки журнала без команды, которые под этим чипом ДОБАВЛЯЮТСЯ к отбору
 *  по команде: командный отбор (`team_id IN (…)`) их не видит никогда. Чипа
 *  нет — добавлять нечего, компания уже целиком. */
export function teamlessLedgerRows<
  R extends { team_id: string | null; account_id: string | null },
>(
  companyRows: readonly R[],
  scope: string | null | undefined,
  accountTeam: ReadonlyMap<string, string | null>,
): R[] {
  if (!scope) return [];
  return companyRows.filter((row) => {
    if (row.team_id !== null) return false;
    const team = row.account_id ? (accountTeam.get(row.account_id) ?? null) : null;
    return scope === NO_TEAM ? team === null : team === scope;
  });
}

/** Отбор чипа плюс строки без команды — без повторов по id. Нечего добавить —
 *  ТОТ ЖЕ массив: новая ссылка роняла бы мемоизацию всего экрана. */
export function withTeamlessRows<R extends { id: string }>(
  scoped: R[],
  extra: readonly R[],
): R[] {
  if (extra.length === 0) return scoped;
  const seen = new Set(scoped.map((row) => row.id));
  const added = extra.filter((row) => !seen.has(row.id));
  return added.length > 0 ? [...scoped, ...added] : scoped;
}

/** Есть ли у компании деньги, которым нужен чип «Без команды»: рабочая запись
 *  без команды, долг без команды или строка журнала без команды не на счёте
 *  команды. События и личное без команды — норма, денег у них нет. */
export function hasTeamlessMoney({
  appointments,
  debts,
  companyRows,
  accountTeam,
}: {
  appointments: readonly { team_id?: string | null; kind?: string | null }[];
  debts: readonly { team_id: string | null }[];
  companyRows: readonly { team_id: string | null; account_id: string | null }[];
  accountTeam: ReadonlyMap<string, string | null>;
}): boolean {
  return (
    appointments.some((a) => a.team_id == null && (a.kind ?? "work") === "work") ||
    debts.some((d) => d.team_id == null) ||
    teamlessLedgerRows(companyRows, NO_TEAM, accountTeam).length > 0
  );
}
