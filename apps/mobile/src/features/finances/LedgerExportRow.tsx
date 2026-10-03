import { useRef, useState } from "react";
import { CalendarRange, FileSpreadsheet } from "lucide-react-native";
import { listTransactionsForRange } from "@babun/shared/db/repositories/finance-transactions";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { SettingsRow } from "@/components/ui/SettingsRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { useToast } from "@/components/ui/Toast";
import { supabase } from "@/lib/supabase";
import { useTenantId } from "@/lib/tenant";
import { useThemeColors } from "@/theme/colors";
import { useClients } from "@/features/clients/queries";
import { useMasters, useTeams } from "@/features/reference/queries";
import { useAccountsWithBalances } from "./accounts";
import { shareLedgerCsv } from "./ledger-export";
import { PERIOD_LABELS, presetHint, presetRange, type PeriodKind } from "./period";
import { useFinanceCategories } from "./queries";
import { exportLedgerRows } from "./team-scope";
import { getCurrentTimeInZone } from "@babun/shared/common/utils/date-utils";
import { useCalendarSettings } from "@/features/settings/local-settings";

// ВЫГРУЗКА ДЛЯ БУХГАЛТЕРА — СТРОКОЙ В «НАСТРОЙКАХ ФИНАНСОВ» (аудит 2026-09-24).
//
// Это не ежедневное действие, поэтому ему не место на главном экране денег,
// где главное действие одно — «Добавить операцию». Строка открывает выбор
// периода (те же слова, что в шапке «Финансов»), тап — файл CSV уходит в
// системное «Поделиться»: почта, мессенджер, «Файлы». Строку видит только
// владелец — её ставит тот же гейт, что и остальные денежные строки.

const PERIODS: PeriodKind[] = [
  "lastmonth",
  "month",
  "lastquarter",
  "quarter",
  "lastyear",
  "year",
];

/** ВЫГРУЗКА — ПО КОМАНДЕ (владелец 2026-09-30: «выгрузка закрепляется только
 *  под команду, не под все»). `teamId` — команда, открытая в «Настройках
 *  финансов»: в файл идут только её операции, имя команды — в заголовке. */
export function LedgerExportRow({ teamId }: { teamId: string | null }) {
  const t = useThemeColors();
  const toast = useToast();
  const tenantId = useTenantId();
  // С удалёнными: колонка «Счёт» у прошлой операции не пустеет.
  const accounts = useAccountsWithBalances({ includeInactive: true, includeDeleted: true });
  const categories = useFinanceCategories();
  const clients = useClients();
  const teams = useTeams({ includeInactive: true });
  const people = useMasters({ includeInactive: true });
  const timeZone = useCalendarSettings().data?.timezone ?? "Europe/Nicosia";
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Выбранный период ждёт ухода листа: «Поделиться» — отдельное окно, и
   *  поверх уезжающего листа iOS его не покажет. */
  const pending = useRef<PeriodKind | null>(null);

  const run = async (kind: PeriodKind) => {
    if (!tenantId) return;
    setBusy(true);
    try {
      // Период и строки — как на экране «Финансов» (аудит 2026-10-03): сегодня
      // по поясу компании, а не по часам телефона, и строки без команды,
      // чьи деньги лежат на счетах этой команды.
      const { from, to } = presetRange(kind, getCurrentTimeInZone(timeZone));
      const all = await listTransactionsForRange(supabase, tenantId, from, to);
      const accountTeam = new Map(
        (accounts.data ?? []).map((account) => [account.id, account.brigade_id ?? null] as const),
      );
      const transactions = exportLedgerRows(all, teamId, accountTeam);
      const teamName = teamId
        ? (teams.data ?? []).find((team) => team.id === teamId)?.name
        : undefined;
      if (transactions.length === 0) {
        toast(`За «${PERIOD_LABELS[kind].toLowerCase()}» операций нет`);
        return;
      }
      await shareLedgerCsv({
        transactions,
        refs: {
          accounts: accounts.data ?? [],
          categories: categories.data ?? [],
          clients: clients.data ?? [],
          teams: teams.data ?? [],
          people: people.data ?? [],
        },
        from,
        to,
        title: [teamName, PERIOD_LABELS[kind], presetHint(kind)].filter(Boolean).join(" · "),
      });
    } catch (e) {
      toast(
        `Не удалось выгрузить: ${e instanceof Error ? e.message : String(e)}`,
        "error",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SettingsRow
        tile={SETTINGS_TILE.green}
        icon={FileSpreadsheet}
        title="Выгрузка для бухгалтера"
        sub={busy ? "Готовим файл…" : "CSV за период"}
        onPress={() => {
          if (!busy) setOpen(true);
        }}
      />
      <PickerSheet
        visible={open}
        title="Выгрузить за период"
        items={PERIODS.map((kind) => ({
          id: kind,
          label: PERIOD_LABELS[kind],
          hint: presetHint(kind),
          icon: CalendarRange,
          color: t.accent,
          onPress: () => {
            pending.current = kind;
          },
        }))}
        onClose={() => setOpen(false)}
        onExited={() => {
          const kind = pending.current;
          pending.current = null;
          if (kind) void run(kind);
        }}
      />
    </>
  );
}
