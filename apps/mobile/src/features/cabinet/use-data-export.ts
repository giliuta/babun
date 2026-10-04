import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTeams } from "@/features/reference/queries";
import { useDataRole } from "@/features/settings/tenant";
import { shareCsvFile } from "@/lib/share-csv";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import {
  appointmentsToCsv,
  clientsToCsv,
  dateStamp,
  exportDialogTitle,
  exportFilename,
  financeTeamFilter,
  transactionsToCsv,
  type AccountRef,
  type AppointmentExportRow,
  type ClientExportRow,
  type ExportKind,
  type SourceRef,
  type TransactionExportRow,
} from "./data-export";

// ЧТЕНИЕ ДЛЯ «ВЫГРУЗКИ ДАННЫХ» (Кабинет, владелец 03.10: «выгрузить все данные
// можно, но только из своих личных команд»).
//
// ЧУЖОЕ НЕ ВЫГРУЖАЕТСЯ ТРЕМЯ ЗАМКАМИ:
//   1. выгрузка работает только у владельца активной компании (`useDataRole`):
//      партнёру, которому поделились командой, она закрыта целиком;
//   2. каждый запрос несёт `tenant_id` этой компании — в её базе чужих команд
//      нет вовсе, они читаются через заголовок чужой компании;
//   3. выбранная команда обязана быть среди СВОИХ (`useTeams`), иначе выгрузка
//      отказывает, а не молча идёт по чужому id.
//
// КОМАНДА НЕ ВЫБРАНА — ВСЯ КОМПАНИЯ БЕЗ ОТБОРА ПО КОМАНДЕ. Отбор «все id своих
// команд» терял строки без команды и строки архивных команд — а владелец
// просит «все данные». Выбрана команда — отбор по ней.

const PAGE_SIZE = 1000;

interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/** Читает таблицу страницами по тысяче до последней неполной. Страница берёт
 *  СВЕЖИЙ запрос: построитель postgrest копит параметры, и один запрос на все
 *  страницы дублировал бы `order`. */
async function readAll<T>(
  label: string,
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    // Исходная ошибка с её кодом и статусом, а не склейка «Клиенты: …»:
    // экран узнаёт по ней обрыв и говорит «Нет связи с сервером».
    if (error) throw Object.assign(new Error(error.message), { status: (error as { status?: number }).status, code: (error as { code?: string }).code, label });
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) return out;
  }
}

const CLIENT_COLUMNS =
  "id, full_name, phone, email, team_id, city, acquisition_source, birthday, comment, notes, created_at";
const APPOINTMENT_COLUMNS =
  "id, date, time_start, time_end, kind, team_id, client_id, status, services, total_amount, paid_amount, prepaid_amount, payment_status, payments, payment, address, comment, event_notes";
const TRANSACTION_COLUMNS =
  "id, type, amount, occurred_on, occurred_time, category_id, account_id, team_id, client_id, notes, vat_amount, vat_mode, created_at";

// ─── Справочники: имена вместо id ───────────────────────────────────────────

interface ExportRefs {
  categories: Map<string, string>;
  accounts: Map<string, string>;
  accountRefs: AccountRef[];
  services: Map<string, string>;
  sources: SourceRef[];
}

const toMap = (rows: readonly { id: string; name: string }[]) =>
  new Map(rows.map((row) => [row.id, row.name] as const));

async function fetchRefs(tenantId: string): Promise<ExportRefs> {
  const [categories, accounts, sources, services] = await Promise.all([
    // Системные категории (`tenant_id is null`) тоже называют операции:
    // автопроводки записей лежат на них.
    readAll("Категории", (from, to) =>
      supabase
        .from("finance_categories")
        .select("id, name")
        .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
        .order("id")
        .range(from, to),
    ),
    // С удалёнными: у прошлой операции колонка «Счёт» не пустеет.
    readAll("Счета", (from, to) =>
      supabase
        .from("accounts")
        .select("id, name, brigade_id")
        .eq("tenant_id", tenantId)
        .order("id")
        .range(from, to),
    ),
    readAll("Источники клиентов", (from, to) =>
      supabase
        .from("client_sources")
        .select("id, name, key, team_id")
        .eq("tenant_id", tenantId)
        .order("id")
        .range(from, to),
    ),
    readAll("Услуги", (from, to) =>
      supabase
        .from("services")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .order("id")
        .range(from, to),
    ),
  ]);
  return {
    categories: toMap(categories),
    accounts: toMap(accounts),
    accountRefs: accounts,
    services: toMap(services),
    sources,
  };
}

/** Имена ВСЕХ клиентов компании, и удалённых тоже: прошлая запись или
 *  операция называет клиента, которого уже убрали из списка. Без отбора по
 *  команде — запись команды А может стоять на клиенте команды Б. */
async function fetchClientNames(tenantId: string): Promise<Map<string, string>> {
  const rows = await readAll("Клиенты", (from, to) =>
    supabase
      .from("clients")
      .select("id, full_name")
      .eq("tenant_id", tenantId)
      .order("id")
      .range(from, to),
  );
  return new Map(rows.map((row) => [row.id, row.full_name] as const));
}

// ─── Выборки одной команды / всей компании ──────────────────────────────────

function readClients(tenantId: string, teamId: string | null): Promise<ClientExportRow[]> {
  return readAll("Клиенты", (from, to) => {
    const q = supabase
      .from("clients")
      .select(CLIENT_COLUMNS)
      .eq("tenant_id", tenantId)
      .is("deleted_at", null);
    return (teamId ? q.eq("team_id", teamId) : q).order("id").range(from, to);
  });
}

function readAppointments(
  tenantId: string,
  teamId: string | null,
): Promise<AppointmentExportRow[]> {
  return readAll("Записи", (from, to) => {
    // Все виды: и работы, и личные события.
    const q = supabase.from("appointments").select(APPOINTMENT_COLUMNS).eq("tenant_id", tenantId);
    return (teamId ? q.eq("team_id", teamId) : q).order("id").range(from, to);
  });
}

function readTransactions(
  tenantId: string,
  teamId: string | null,
  accounts: readonly AccountRef[],
): Promise<TransactionExportRow[]> {
  const scope = teamId ? financeTeamFilter(teamId, accounts) : null;
  return readAll("Финансы", (from, to) => {
    const q = supabase
      .from("finance_transactions")
      .select(TRANSACTION_COLUMNS)
      .eq("tenant_id", tenantId);
    return (scope ? q.or(scope) : q).order("id").range(from, to);
  });
}

// ─── Счётчики для подписей строк ────────────────────────────────────────────

export type ExportCounts = Record<ExportKind, number>;

async function countOf(
  label: string,
  query: PromiseLike<{ count: number | null; error: { message: string } | null }>,
): Promise<number> {
  const { count, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return count ?? 0;
}

async function fetchCounts(
  tenantId: string,
  teamId: string | null,
  accounts: readonly AccountRef[],
): Promise<ExportCounts> {
  const head = { count: "exact", head: true } as const;
  const scope = teamId ? financeTeamFilter(teamId, accounts) : null;

  const clients = supabase
    .from("clients")
    .select("id", head)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null);
  const appointments = supabase.from("appointments").select("id", head).eq("tenant_id", tenantId);
  const finances = supabase.from("finance_transactions").select("id", head).eq("tenant_id", tenantId);

  const [clientsCount, appointmentsCount, financesCount] = await Promise.all([
    countOf("Клиенты", teamId ? clients.eq("team_id", teamId) : clients),
    countOf("Записи", teamId ? appointments.eq("team_id", teamId) : appointments),
    countOf("Финансы", scope ? finances.or(scope) : finances),
  ]);
  return { clients: clientsCount, appointments: appointmentsCount, finances: financesCount };
}

// ─── Хук экрана ─────────────────────────────────────────────────────────────

/** `teamId` — выбранная команда или `null` («все свои»). */
export function useDataExport(teamId: string | null) {
  const tenantId = useTenantId();
  const role = useDataRole().data;
  // С архивными: колонка «Команда» у прошлых строк не пустеет.
  const teams = useTeams({ includeInactive: true });
  const isOwner = role === "owner" && !!tenantId;
  const [busy, setBusy] = useState<ExportKind | null>(null);
  // Второй тап до перерисовки не должен запустить вторую выгрузку.
  const running = useRef(false);

  const refs = useQuery({
    queryKey: ["data-export", "refs", tenantId],
    enabled: isOwner,
    staleTime: 60_000,
    queryFn: () => fetchRefs(tenantId as string),
  });

  const counts = useQuery({
    queryKey: ["data-export", "counts", tenantId, teamId],
    enabled: isOwner && refs.isSuccess,
    staleTime: 60_000,
    queryFn: () => fetchCounts(tenantId as string, teamId, refs.data?.accountRefs ?? []),
  });

  const teamNames = useMemo(
    () => new Map((teams.data ?? []).map((team) => [team.id, team.name] as const)),
    [teams.data],
  );

  const run = useCallback(
    async (kind: ExportKind) => {
      if (running.current) return;
      running.current = true;
      setBusy(kind);
      try {
        if (!isOwner || !tenantId) {
          throw new Error("Выгрузка доступна только владельцу аккаунта");
        }
        if (teams.data === undefined) {
          throw new Error("Команды ещё загружаются, повторите через секунду");
        }
        // Замок 3: выбранная команда — среди своих.
        if (teamId && !teamNames.has(teamId)) {
          throw new Error("Эта команда не из вашего аккаунта");
        }
        const known = refs.data ?? (await fetchRefs(tenantId));

        let contents: string;
        let count: number;
        if (kind === "clients") {
          const rows = await readClients(tenantId, teamId);
          contents = clientsToCsv(rows, { teams: teamNames, sources: known.sources });
          count = rows.length;
        } else if (kind === "appointments") {
          const [rows, clients] = await Promise.all([
            readAppointments(tenantId, teamId),
            fetchClientNames(tenantId),
          ]);
          contents = appointmentsToCsv(rows, {
            teams: teamNames,
            clients,
            services: known.services,
          });
          count = rows.length;
        } else {
          const [rows, clients] = await Promise.all([
            readTransactions(tenantId, teamId, known.accountRefs),
            fetchClientNames(tenantId),
          ]);
          contents = transactionsToCsv(rows, {
            categories: known.categories,
            accounts: known.accounts,
            teams: teamNames,
            clients,
          });
          count = rows.length;
        }

        const stamp = dateStamp(new Date());
        await shareCsvFile({
          contents,
          filename: exportFilename(kind, stamp),
          dialogTitle: exportDialogTitle(kind, stamp, count),
        });
      } finally {
        running.current = false;
        setBusy(null);
      }
    },
    [isOwner, tenantId, teamId, teamNames, teams.data, refs.data],
  );

  return {
    counts: counts.data,
    countsLoading: counts.isLoading || refs.isLoading,
    busy,
    run,
  };
}
