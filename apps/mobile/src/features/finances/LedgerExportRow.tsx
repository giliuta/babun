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

export function LedgerExportRow() {
  const t = useThemeColors();
  const toast = useToast();
  const tenantId = useTenantId();
  const accounts = useAccountsWithBalances({ includeInactive: true });
  const categories = useFinanceCategories();
  const clients = useClients();
  const teams = useTeams({ includeInactive: true });
  const people = useMasters({ includeInactive: true });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Выбранный период ждёт ухода листа: «Поделиться» — отдельное окно, и
   *  поверх уезжающего листа iOS его не покажет. */
  const pending = useRef<PeriodKind | null>(null);

  const run = async (kind: PeriodKind) => {
    if (!tenantId) return;
    setBusy(true);
    try {
      const { from, to } = presetRange(kind);
      const transactions = await listTransactionsForRange(supabase, tenantId, from, to);
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
        title: `${PERIOD_LABELS[kind]} · ${presetHint(kind)}`,
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
        sub={busy ? "Готовим файл…" : "Операции за период — таблицей CSV"}
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
