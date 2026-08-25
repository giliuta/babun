import { useEffect, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { Settings } from "lucide-react-native";
import { useIsFetching } from "@tanstack/react-query";
import {
  formatSignedMoneyExact,
  money,
  moneySign,
} from "@babun/shared/common/utils/money";
import type { FinanceTransaction } from "@babun/shared/local/finance/transaction";
import { canEditTransaction } from "@babun/shared/local/finance/transaction";
import { Card } from "@/components/ui/Card";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Divider } from "@/components/ui/Divider";
import { LoadingBar } from "@/components/ui/LoadingBar";
import { Spinner } from "@/components/ui/Spinner";
import { ActionRow, NavRow, RowCaption, RowGroup } from "@/components/ui/card-rows";
import { NEUTRAL_GLYPH } from "@/components/ui/SettingsRow";
import { SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { useToast } from "@/components/ui/Toast";
import { GUTTER, ICON } from "@/components/ui/tokens";
import { usePullRefresh } from "@/lib/pull-refresh";
import { confirmThen } from "@/lib/confirm";
import { notify } from "@/lib/notify";
import { shareCsvFile } from "@/lib/share-csv";
import { useThemeColors } from "@/theme/colors";
import { useIsOnline } from "@babun/shared/sync";
import { useTeams } from "@/features/reference/queries";
import { useAllServices } from "@/features/services/queries";
import { useAppointments } from "@/features/calendar/queries";
import { useClients } from "@/features/clients/queries";
import { useInvoiceNavigation } from "@/features/invoices/navigation";
import {
  useAccountPeriodTotals,
  useAccountsWithBalances,
  useDeleteTransfer,
} from "@/features/finances/accounts";
import {
  useDeleteTransaction,
  useFetchLedgerRange,
  useFinanceCategories,
  useInsertTransaction,
  useRefundTotals,
  useTransactions,
} from "@/features/finances/queries";
import {
  deleteTransferAlert,
  ACCOUNT_GONE,
  AGGREGATE_FAILED_RETRY,
  OFFLINE_ACCOUNT_ACTIONS,
} from "@/features/finances/account-alerts";
import { accountIcon, accountSubtitle } from "@/features/finances/account-ui";
import { cashCountAlert } from "@/features/finances/accounts-sections";
import { CashCountSheet } from "@/features/finances/CashCountSheet";
import { lastCountedOn, useLastCashCounts } from "@/features/finances/cash-counts";
import {
  accountPeriodClosing,
  accountPeriodRows,
  type AccountPeriodSummary,
} from "@/features/finances/account-period";
import { accountStatementToCsv } from "@/features/finances/export";
import {
  capitalizeFirst,
  dayPhrase,
  monthPeriodOf,
  periodDates,
  periodPhrase,
} from "@/features/finances/period";
import {
  PeriodPresetModal,
  PeriodWheelsModal,
} from "@/features/finances/PeriodSheets";
import { buildRefundDraft } from "@/features/finances/refund";
import { useBusinessPeriod } from "@/features/finances/use-business-period";
import { TransferSheet } from "@/features/finances/TransferSheet";
import { TransactionsFeed } from "@/features/finances/TransactionsFeed";
import { TransactionPopup } from "@/features/finances/TransactionPopup";
import { OperationSheet } from "@/features/finances/OperationSheet";

// КАРТОЧКА СЧЁТА (ТЗ 2026-08-10 §6).
//
// Список отвечает «сколько и у кого», карточка — «что тут было и что с этим
// делать». Отсюда три вещи, которых здесь раньше не было вовсе:
//   • СВЕРЯЕМАЯ КОЛОНКА ЗА ПЕРИОД для ЛЮБОГО счёта. Итог периода жил внутри
//     блока «поступления по командам», а тот рисуется только у счёта компании
//     — то есть у 90% счетов дельты периода не было, хотя расчёт уже был;
//   • ДЕЙСТВИЯ. `OperationSheet` был смонтирован, но открывался только тапом
//     по существующей операции: на пустом счёте лист недостижим в принципе, и
//     экран с именем кассы не давал положить в неё деньги;
//   • КОГДА СЧЁТ ТРОГАЛИ. €0 брошенной кассы и €0 сданной сегодня выглядели
//     одинаково — а это главный вопрос доверия к остатку.
//
// Все деньги колонки приходят с сервера УЖЕ СО ЗНАКОМ и только складываются
// (см. account-period.ts): ни одного минуса на клиенте.

/** Строка сверяемой колонки: слово слева, одно число справа.
 *
 *  ИТОГ ОТЛИЧАЕТСЯ ОТ СЛАГАЕМОГО (2026-08-12). Шесть строк по 44pt набирались
 *  почти одним весом: ink-высота ярлыка «Приход» — 12.7pt, ярлыка «Остаток на
 *  конец» — те же 12.7pt, вся разница между суммой и слагаемым сводилась к
 *  0.3px обводки. Теперь итог — своя ступень: крупнее, выше и на собственной
 *  подложке. Подсвеченная строка итога — стандарт бухгалтерской таблицы, а не
 *  украшение. */
function ColumnRow({
  label,
  value,
  color,
  strong,
}: {
  label: string;
  value: string;
  color: string;
  strong?: boolean;
}) {
  const t = useThemeColors();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        minHeight: strong ? 56 : 44,
        paddingHorizontal: 16,
        backgroundColor: strong ? t.rowFill : undefined,
      }}
    >
      <Text
        maxFontSizeMultiplier={1.2}
        numberOfLines={1}
        style={{
          flexShrink: 1,
          fontSize: strong ? 17 : 15,
          lineHeight: strong ? 22 : 20,
          // Слагаемое НАЗЫВАЕТ движение, а не заявляет его: обычный вес против
          // жирного у итога — эту разницу и читают, пробегая колонку.
          fontWeight: strong ? "700" : "400",
          color: t.ink,
        }}
      >
        {label}
      </Text>
      <View style={{ flex: 1, alignItems: "flex-end" }}>
        <Text
          maxFontSizeMultiplier={1.2}
          numberOfLines={1}
          style={{
            fontSize: strong ? 22 : 15,
            lineHeight: strong ? 28 : 20,
            fontWeight: strong ? "800" : "600",
            color,
            fontVariant: ["tabular-nums"],
          }}
        >
          {value}
        </Text>
      </View>
    </View>
  );
}

function AccountDetailContent() {
  const t = useThemeColors();
  const router = useRouter();
  const toast = useToast();
  const online = useIsOnline();
  const { id } = useLocalSearchParams<{ id: string }>();

  const accountsQuery = useAccountsWithBalances({ includeInactive: true });
  const accounts = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);
  const account = accounts.find((a) => a.id === id) ?? null;
  const activeAccounts = useMemo(
    () => accounts.filter((a) => a.is_active),
    [accounts],
  );

  const allTeamsQuery = useTeams({ includeInactive: true });
  const teams = useMemo(() => allTeamsQuery.data ?? [], [allTeamsQuery.data]);
  const teamById = useMemo(
    () => new Map(teams.map((team) => [team.id, team])),
    [teams],
  );

  // Один контрол периода на весь продукт — тот же сплит, что в шапке
  // «Финансов»: имя периода открывает пресеты, точные даты — барабаны «С–До».
  const { businessToday, businessNow, period, setPeriod } = useBusinessPeriod();
  const [periodOpen, setPeriodOpen] = useState(false);
  const [wheelsOpen, setWheelsOpen] = useState(false);

  // СРЕЗ ЖУРНАЛА РОВНО ПОД ЗАДАЧУ ЭКРАНА. Счёту КОМПАНИИ нужен полный месячный
  // срез: инкассацию атрибуцирует вторая нога перевода, а она лежит на чужом
  // счёте — из среза одного счёта пару не увидеть. Обычной кассе хватает её
  // собственных операций, и тянуть ради неё журнал всего тенанта незачем.
  //
  // Пока строка счёта не приехала, срез не выбран и запрос не уходит: угадать
  // здесь значит один раз сходить впустую и вторым запросом идти за настоящим
  // срезом. Ключ ложится под существующий префикс ["transactions"] —
  // инвалидация леджера покрывает страницу бесплатно.
  const ledgerAccountIds = useMemo(
    () => (account && account.scope !== "company" ? [account.id] : undefined),
    [account],
  );
  const txsQuery = useTransactions(period.from, period.to, {
    accountIds: ledgerAccountIds,
    // `account === null` — либо строка ещё не приехала, либо счёта нет вовсе.
    // В обоих случаях журнал не нужен: во втором экран говорит «Счёта больше
    // нет», в первом — срез пока не выбран.
    enabled: account !== null,
  });
  const txs = useMemo(() => txsQuery.data ?? [], [txsQuery.data]);
  const accountTxs = useMemo(
    () => txs.filter((tx) => tx.account_id === id),
    [txs, id],
  );
  // Чужой период под новой подписью не показывается никогда: пока приезжает
  // новый срез, старый гаснет и над экраном идёт полоска. Тем же флагом
  // закрыта выгрузка: выписка, собранная из прошлого месяца под именем
  // текущего, уедет бухгалтеру и вернётся вопросом через квартал.
  const stale = txsQuery.isPlaceholderData;

  const periodTotalsQuery = useAccountPeriodTotals(period.from, period.to);
  // `account_period_totals` возвращает строку на КАЖДЫЙ счёт тенанта (full
  // join по счетам), поэтому «строки нет» означает «ещё не приехало», а не
  // «нулевой месяц». Выдумывать нули на месте незагруженного ответа нельзя:
  // на экране с деньгами молчаливый ноль — это ложь.
  const totals = useMemo<AccountPeriodSummary | null>(() => {
    const row = periodTotalsQuery.data?.find((r) => r.account_id === id);
    if (!row) return null;
    const { account_id: _ignored, ...rest } = row;
    return rest;
  }, [periodTotalsQuery.data, id]);

  const categories = useFinanceCategories().data ?? [];
  // Лента операций счёта — чтение прошлого, включая убранные услуги.
  const services = useAllServices().data ?? [];
  const appointments = useAppointments().data ?? [];
  const clients = useClients().data ?? [];
  const refundTotals = useRefundTotals().data;
  const { openTransactionInvoice } = useInvoiceNavigation();

  const delTransfer = useDeleteTransfer();
  const delTx = useDeleteTransaction();
  const insertTx = useInsertTransaction();
  const fetchLedgerRange = useFetchLedgerRange();

  // Сверки касс. Экран не гейтит: пока ответа нет, про сверку молчим — «ни
  // разу не сверяли» это утверждение о деньгах, и по незнанию его не печатают.
  const cashCounts = useLastCashCounts();
  const lastCount = cashCounts.last?.byAccount.get(id as string) ?? null;

  const [transferOpen, setTransferOpen] = useState(false);
  const [countOpen, setCountOpen] = useState(false);
  const [popupTx, setPopupTx] = useState<FinanceTransaction | null>(null);
  const [editingTx, setEditingTx] = useState<FinanceTransaction | null>(null);
  const [opOpen, setOpOpen] = useState(false);

  const refreshAll = () =>
    Promise.all([
      accountsQuery.refetch(),
      allTeamsQuery.refetch(),
      txsQuery.refetch(),
      periodTotalsQuery.refetch(),
      cashCounts.refetch(),
    ]);
  const pull = usePullRefresh(refreshAll);
  const busy = useIsFetching({ queryKey: ["accounts"] });

  // ОСТАТОК НА КОНЕЦ ОБЯЗАН СОЙТИСЬ С ГЕРОЕМ, когда период включает сегодня:
  // это два способа посчитать одно число, и расхождение между ними — ошибка
  // группировки, а не особенность экрана. В проде колонка при этом всё равно
  // рисуется (прятать от человека его же деньги хуже, чем показать
  // расхождение), в разработке — красный лог с обоими числами.
  const periodHasToday = period.from <= businessToday && businessToday <= period.to;
  const closing = totals ? accountPeriodClosing(totals) : null;
  const columnMismatch =
    account !== null
    && closing !== null
    && periodHasToday
    && moneySign(closing - account.balance) !== 0;
  useEffect(() => {
    if (__DEV__ && columnMismatch && account && closing !== null) {
      console.error(
        `[account ${account.id}] колонка за период не сходится с остатком: `
        + `на конец ${closing}, сейчас на счёте ${account.balance}`,
      );
    }
  }, [columnMismatch, account, closing]);

  const confirmDeleteTransfer = (tx: FinanceTransaction) => {
    const text = deleteTransferAlert();
    confirmThen(
      text.title,
      {
        message: text.message,
        confirmLabel: text.confirm,
        destructive: true,
      },
      async () => {
        try {
          if (!tx.transfer_group_id) {
            throw new Error(
              "У перевода повреждена связь между счетами. Операция не изменена.",
            );
          }
          await delTransfer.mutateAsync(tx.transfer_group_id);
        } catch (e) {
          notify("Не удалось удалить перевод", (e as Error).message);
        }
      },
    );
  };

  // Возврат собирает общий `buildRefundDraft` — тот же, что на «Финансах»:
  // правило возврата одно на продукт и чинится в одном месте. Хаптик успеха
  // НЕ здесь: возврат проводится только через TransactionPopup, и сигналит
  // он — второй вызов на экране давал двойную вибрацию.
  const handleRefund = async (tx: FinanceTransaction, amount: number) => {
    if (tx.source === "auto") {
      throw new Error("Возврат этой оплаты оформляется в связанной заявке.");
    }
    await insertTx.mutateAsync(buildRefundDraft(tx, amount, businessToday));
  };

  const openOperation = () => {
    setEditingTx(null);
    setOpOpen(true);
  };

  /**
   * Открыть заявку в календаре — тем же адресом, что на «Финансах» и в чеке:
   * календарь сам встаёт на её день и команду. Возвращает false, если записи
   * нет в загруженном окне: уводить на экран «заявка не найдена» хуже, чем
   * показать витрину операции.
   *
   * `&from=account:<id>` — обратная дорога: закрыв запись, человек
   * возвращается на карточку счёта, а не остаётся в календаре (вкладки — не
   * стек; словарь from= живёт в app/(dashboard)/index.tsx, страница инвойса
   * шлёт invoice:<id> тем же механизмом).
   */
  const openAppointment = (appointmentId: string): boolean => {
    const target = appointments.find((a) => a.id === appointmentId);
    if (!target) return false;
    router.push(
      (`/(dashboard)?appointmentId=${target.id}&date=${target.date}`
        + (target.team_id ? `&teamId=${target.team_id}` : "")
        + `&from=account:${id as string}`) as Href,
    );
    return true;
  };

  // ВЕТВЛЕНИЕ ПО «ДАННЫХ НЕТ», А НЕ ПО isPending (§8): без сети запрос стоит в
  // paused и остаётся pending навсегда — карточка крутила бы спиннер вечно.
  // Порядок тот же, что на списке: ошибка (сервер ответил и отказал) → офлайн
  // без данных (спрашивать некого) → загрузка.
  const hasData =
    accountsQuery.data !== undefined && allTeamsQuery.data !== undefined;
  // Ошибка сети — НЕ «счёт не найден»: у неё есть «Повторить».
  const loadError = hasData
    ? null
    : (accountsQuery.error ?? allTeamsQuery.error ?? null);
  if (loadError) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Счёт" />
        <EmptyState
          state="error"
          fill
          title="Не удалось загрузить счёт"
          subtitle={loadError instanceof Error ? loadError.message : undefined}
          action={{ label: "Повторить", onPress: () => void refreshAll() }}
        />
      </Screen>
    );
  }
  if (!hasData) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Счёт" />
        {online ? (
          <EmptyState state="loading" fill title="Загружаем счёт" />
        ) : (
          <EmptyState
            fill
            title="Нет сети"
            subtitle="Счёт ещё не загружен на это устройство"
            action={{ label: "Повторить", onPress: () => void refreshAll() }}
          />
        )}
      </Screen>
    );
  }
  if (!account) {
    return (
      <Screen edges={["top"]}>
        <ScreenHeader title="Счёт" />
        <EmptyState
          fill
          title={ACCOUNT_GONE.title}
          subtitle={ACCOUNT_GONE.message}
          action={{
            label: "К списку счетов",
            onPress: () => router.replace("/accounts"),
          }}
        />
      </Screen>
    );
  }

  // ─── Подписи героя ───────────────────────────────────────────────────────

  // Значок счёта — ВЫБРАННЫЙ владельцем, как в строке списка; не выбран —
  // глиф по виду счёта (фолбэк внутри `accountIcon`).
  const Icon = accountIcon(account);
  // ЧЕЙ ЭТО СЧЁТ — ОДНО ПРАВИЛО НА ПРОДУКТ (`accountSubtitle`): счёт
  // нескольких команд называется по своим командам («Наличные · Юра, Аня»), и
  // называется одинаково здесь, в списке счетов и в листе пересчёта. Слова
  // «Счёт компании» в продукте больше нет (владелец 2026-08-11).
  const subtitle = accountSubtitle(account, (teamId) =>
    teamById.get(teamId)?.name ?? null,
  );

  // Когда эту кассу держали в руках. Янтарь — только у «давно»: у свежей
  // сверки это спокойное показание, а не тревога.
  const countAlert =
    account.kind === "cash"
      ? cashCountAlert(
          lastCountedOn(cashCounts.last, account.id),
          account.first_tx_on,
          businessToday,
        )
      : null;
  const countCaption =
    account.kind !== "cash"
      ? null
      : countAlert
        ? { text: countAlert, color: t.warning }
        : lastCount
          ? {
              text: `Пересчитывали ${dayPhrase(lastCount.businessDate)}`,
              color: t.faint,
            }
          : null;
  /** Значение строки «Пересчитать»: `undefined`, пока сверки не приехали —
   *  пустое место честнее выдуманного «Ни разу». */
  const countValue = lastCount
    ? `Сверяли ${dayPhrase(lastCount.businessDate)}`
    : cashCounts.last?.complete
      ? "Ни разу"
      : undefined;

  // Свежая цифра или брошенный счёт — единственный вопрос доверия к остатку.
  const lastTouched = account.last_tx_on
    ? `Последняя операция — ${dayPhrase(account.last_tx_on)}${
        account.last_tx_on.slice(0, 4) === businessToday.slice(0, 4)
          ? ""
          : ` ${account.last_tx_on.slice(0, 4)}`
      }`
    : "Операций не было";

  const negative = moneySign(account.balance) < 0;
  const periodWords = periodPhrase(period);

  // ─── Выгрузка ────────────────────────────────────────────────────────────

  const exportStatement = async () => {
    if (!totals || stale) return;
    try {
      // Колонке «Корреспондент» нужна ВТОРАЯ нога перевода, а она лежит на
      // чужом счёте: в суженный срез карточки она не попадает. Полный журнал
      // периода берём здесь, по нажатию, — держать ради одной колонки
      // постоянную подписку на весь журнал тенанта незачем.
      const ledger = ledgerAccountIds
        ? await fetchLedgerRange(period.from, period.to)
        : txs;
      const report = accountStatementToCsv({
        account,
        ledger,
        categories,
        totals,
        period,
        lookups: {
          teamName: new Map(teams.map((team) => [team.id, team.name])),
          accounts,
        },
      });
      // Имя счёта в имени файла чистится от недопустимого: «Нал/Карта» дал
      // бы путь вместо имени, пробелы и двоеточия ломают выгрузку по AirDrop.
      const safeName = account.name.replace(/[\\/:*?"<>|\s]+/g, "-");
      await shareCsvFile({
        contents: report.contents,
        filename: `babun-${safeName}-${period.from}-${period.to}.csv`,
        // Даты — тем же почерком, что всюду в продукте, а не сырым ISO.
        dialogTitle: `${account.name}: ${periodDates(period)}`,
      });
      toast(`Выписка готова · ${report.count}`, "success");
    } catch (error) {
      notify(
        "Не удалось выгрузить выписку",
        error instanceof Error ? error.message : "Попробуйте ещё раз.",
      );
    }
  };

  // ─── Колонка «ЗА ПЕРИОД» ─────────────────────────────────────────────────

  const toneColor = (tone: "ink" | "success" | "danger") =>
    tone === "success" ? t.success : tone === "danger" ? t.danger : t.ink;

  const periodColumn = totals ? (
    accountPeriodRows(totals).map((row) => (
      <View key={row.key}>
        {/* Итог отбит ЧЕРТОЙ ПОДВЕДЕНИЯ во всю ширину, остальные строки —
            обычным швом с вкладкой: «Остаток на конец» это сумма всего, что
            над ним, и линия обязана это показывать, а не просто разделять. */}
        <Divider
          inset={row.key === "closing" ? 0 : 16}
          strong={row.key === "closing"}
        />
        <ColumnRow
          label={row.label}
          value={row.signed ? formatSignedMoneyExact(row.value) : money(row.value)}
          // НУЛЕВОЕ ДВИЖЕНИЕ — ЭТО ТИШИНА, А НЕ ПОКАЗАНИЕ. «Расход €0» звучит
          // так же громко, как «Расход −€440», и колонка из нулей читалась как
          // незаполненный бланк. Остатки на начало и конец остаются полным
          // чёрным всегда: ноль на счёте — это ответ, а не отсутствие ответа.
          color={
            row.signed && moneySign(row.value) === 0
              ? t.muted
              : toneColor(row.tone)
          }
          strong={row.strong}
        />
      </View>
    ))
  ) : periodTotalsQuery.error ? (
    <>
      <Divider inset={16} />
      <ActionRow
        label={AGGREGATE_FAILED_RETRY}
        onPress={() => void periodTotalsQuery.refetch()}
      />
    </>
  ) : (
    <>
      <Divider inset={16} />
      {/* Компактный спиннер, а не полный EmptyState: колонка живёт ВНУТРИ
          карточки, и 128pt пустоты в ней читаются как сломанная вёрстка.
          Без сети спиннера НЕ БЫВАЕТ: запрос стоит в paused и не двинется
          никогда — вертушка обещала бы цифру, которая не приедет (§8). */}
      <View style={{ alignItems: "center", paddingVertical: 20 }}>
        {online ? (
          <Spinner size={22} label="Считаем период" />
        ) : (
          <Text
            maxFontSizeMultiplier={1.3}
            style={{
              paddingHorizontal: 16,
              fontSize: 13,
              lineHeight: 18,
              textAlign: "center",
              color: t.faint,
            }}
          >
            Период считает сервер — цифры появятся, когда будет связь.
          </Text>
        )}
      </View>
    </>
  );

  // ─── Лента ───────────────────────────────────────────────────────────────

  const feedError = txsQuery.isError && txsQuery.data === undefined;
  const olderPeriod = account.last_tx_on
    ? monthPeriodOf(account.last_tx_on)
    : null;
  const canJumpBack =
    olderPeriod !== null
    && (olderPeriod.from !== period.from || olderPeriod.to !== period.to);

  const feed =
    txsQuery.data === undefined && !txsQuery.isError ? (
      // Ветвление по «данных нет», а не по isPending: без сети запрос стоит в
      // paused и остаётся pending НАВСЕГДА — на его месте крутилась вечная
      // загрузка ленты. Текст — дословно из §8.
      online ? (
        <EmptyState state="loading" />
      ) : (
        <EmptyState
          title="Нет сети"
          subtitle="Операции этого счёта ещё не загружены на это устройство"
          action={{ label: "Повторить", onPress: () => void txsQuery.refetch() }}
        />
      )
    ) : feedError ? (
      // Молчаливые нули врут — отказ запроса показывается.
      <EmptyState
        state="error"
        title="Не удалось загрузить операции"
        action={{ label: "Повторить", onPress: () => void txsQuery.refetch() }}
      />
    ) : accountTxs.length === 0 ? (
      // ЧЕСТНОЕ ПУСТОЕ СОСТОЯНИЕ. «Нет операций за период» читалось как «у
      // счёта нет операций»; экран знает, что история есть, знает где, и обязан
      // это сказать и предложить туда уйти.
      <EmptyState
        title={`За ${periodWords} операций не было`}
        subtitle={account.last_tx_on ? lastTouched : undefined}
        action={
          canJumpBack && olderPeriod
            ? {
                label: `Показать ${periodPhrase(olderPeriod)}`,
                onPress: () => setPeriod(olderPeriod),
              }
            : account.is_active
              ? { label: "Добавить операцию", onPress: openOperation }
              : undefined
        }
      />
    ) : (
      <TransactionsFeed
        transactions={accountTxs}
        accounts={accounts}
        teams={teams}
        categories={categories}
        clients={clients}
        appointments={appointments}
        services={services}
        title={`Операции · ${accountTxs.length}`}
        contextMode="team"
        scroll={false}
        onTxTap={(tx) => {
          if (tx.type === "transfer") {
            confirmDeleteTransfer(tx);
            return;
          }
          // ДЕНЬГИ ПО ЗАПИСИ ОТКРЫВАЮТ САМУ ЗАПИСЬ (владелец 2026-08-15) —
          // то же правило, что на «Финансах»: проводка заявки — зеркало
          // визита, править в ней нечего, а человек хочет увидеть работу.
          if (tx.appointment_id && openAppointment(tx.appointment_id)) return;
          // Тап открывает правку — та же дорога, что в «Финансах».
          if (canEditTransaction(tx)) {
            setEditingTx(tx);
            setOpOpen(true);
            return;
          }
          setPopupTx(tx);
        }}
      />
    );

  return (
    <Screen edges={["top"]}>
      <ScreenHeader
        title={account.name}
        right={
          <Pressable
            onPress={() => router.push(`/accounts/${account.id}/settings`)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Настройки счёта"
            style={({ pressed }) => ({
              height: 40,
              width: 40,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 999,
              backgroundColor: pressed ? t.pressed : "transparent",
            })}
          >
            <Settings color={t.body} size={ICON.sm} />
          </Pressable>
        }
      />
      {/* Фоновое дообновление — полоска под шапкой: контент остаётся на
          месте и ни одна строка не двигается. */}
      <LoadingBar
        visible={
          !pull.refreshing
          && (busy > 0 || stale || periodTotalsQuery.isFetching)
        }
      />

      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={
          <RefreshControl
            refreshing={pull.refreshing}
            onRefresh={pull.onRefresh}
            tintColor={t.accent}
          />
        }
      >
        {/* Герой. Значок и цвет счёта — те же, что в строке списка: их
            владелец выбрал, чтобы узнавать счёт, и на собственной странице
            счёт обязан выглядеть так же. Без выбранного цвета — голый глиф:
            цвет по ДС значит «пришло / ушло / внимание», и выдумывать его
            нельзя. Сумма красится по знаку по тому же правилу, что в
            списке. */}
        <Card
          style={{
            marginHorizontal: GUTTER,
            marginTop: 12,
            paddingHorizontal: 16,
            paddingVertical: 20,
          }}
        >
          <View
            accessible
            accessibilityLabel={[
              `${account.name}, ${subtitle}`,
              negative
                ? `долг ${money(Math.abs(account.balance))}`
                : `на счёте ${money(account.balance)}`,
              account.is_active ? null : "счёт закрыт",
              countCaption?.text ?? null,
              lastTouched,
            ]
              .filter(Boolean)
              .join(", ")}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              {account.color ? (
                // Диск цвета счёта — та же плитка, что в `SettingsRow`.
                <View
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: t.radius.pill,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: account.color,
                  }}
                >
                  <Icon color="#fff" size={16} strokeWidth={2} />
                </View>
              ) : (
                <Icon
                  color={t.ink}
                  size={NEUTRAL_GLYPH.size}
                  strokeWidth={NEUTRAL_GLYPH.strokeWidth}
                />
              )}
              <Text
                maxFontSizeMultiplier={1.3}
                style={{
                  fontSize: 11,
                  lineHeight: 14,
                  fontWeight: "700",
                  letterSpacing: 0.8,
                  textTransform: "uppercase",
                  // Подпись над числом — описывающее: полный чёрный на
                  // денежном экране остаётся у ИМЁН и ЧИСЕЛ.
                  color: t.caption,
                }}
              >
                Сейчас на счёте
              </Text>
            </View>
            {/* Моноширинные цифры — ТОЛЬКО стилем: класс `tabular-nums` в этом
                стеке ничего не делает (см. src/lib/nativewind-traps.test.ts). */}
            <Text
              maxFontSizeMultiplier={1.3}
              style={{
                marginTop: 6,
                fontSize: 34,
                lineHeight: 40,
                fontWeight: "800",
                color: negative ? t.danger : t.ink,
                fontVariant: ["tabular-nums"],
              }}
            >
              {money(account.balance)}
            </Text>
            <Text
              maxFontSizeMultiplier={1.3}
              numberOfLines={2}
              style={{ marginTop: 2, fontSize: 13, fontWeight: "500", color: t.sub }}
            >
              {subtitle}
            </Text>
            {account.is_active ? null : (
              <Text
                maxFontSizeMultiplier={1.3}
                style={{
                  marginTop: 4,
                  fontSize: 13,
                  fontWeight: "600",
                  // Не янтарь: закрытый счёт — нормальное состояние, а не
                  // требование действия. Янтарь в продукте значит «внимание».
                  color: t.sub,
                }}
              >
                Счёт закрыт
              </Text>
            )}
            {countCaption ? (
              <Text
                maxFontSizeMultiplier={1.3}
                style={{
                  marginTop: 4,
                  fontSize: 13,
                  fontWeight: "500",
                  color: countCaption.color,
                }}
              >
                {countCaption.text}
              </Text>
            ) : null}
            <Text
              maxFontSizeMultiplier={1.3}
              style={{ marginTop: 4, fontSize: 13, color: t.faint }}
            >
              {lastTouched}
            </Text>
          </View>
        </Card>

        {/* Действия строкой, а не карточкой ради одной строки. «Операция» —
            единственная дверь к листу на пустом счёте.

            СТРОКИ «СДАТЬ ВЫРУЧКУ» ЗДЕСЬ НЕТ (владелец 2026-08-15). Она
            означала «касса команды → счёт компании», а общего счёта в продукте
            не осталось; вдобавок её обработчик побуквенно совпадал с
            «Перевести» и открывал тот же лист.

            ОФЛАЙН ГРУППА ПОГАШЕНА ЦЕЛИКОМ И ОБЪЯСНЯЕТ СЕБЯ (§8): все строки —
            записи в журнал, а финансы онлайн-only на запись. Открывать
            лист, чтобы человек набрал сумму и упёрся в погашенную кнопку, —
            это работа впустую; на карточке отказ виден до первого тапа. */}
        {account.is_active ? (
          <>
            <RowGroup title="Действия">
              <NavRow
                label="Операция"
                value="Доход или расход"
                dimmed={!online}
                onPress={online ? openOperation : undefined}
              />
              <NavRow
                label="Перевести"
                value="Между счетами"
                separated
                dimmed={!online}
                onPress={online ? () => setTransferOpen(true) : undefined}
              />
              {/* Пересчитывают физическую кучу денег — значит только наличные:
                  на карте и в банке остаток считает банк, и сервер такую сверку
                  отобьёт. */}
              {account.kind === "cash" ? (
                <NavRow
                  label="Пересчитать"
                  value={countValue}
                  separated
                  dimmed={!online}
                  onPress={online ? () => setCountOpen(true) : undefined}
                />
              ) : null}
            </RowGroup>
            {/* Тихая подпись, а не янтарь: тревоги здесь нет — есть причина,
                по которой строки выше погашены. Цвет в этом продукте значит
                «деньги пришли / ушли / требуют внимания». */}
            {online ? null : <RowCaption text={OFFLINE_ACCOUNT_ACTIONS} />}
          </>
        ) : null}

        <View style={{ opacity: stale ? 0.4 : 1 }}>
          <RowGroup
            title="За период"
            footer="Переводы — это ваши же деньги на другом счёте. Они не доход и не расход."
          >
            {/* Период называется словами ровно один раз — здесь, строкой той
                же группы, которой он и управляет. */}
            <NavRow
              label="Период"
              value={capitalizeFirst(periodWords)}
              onPress={() => setPeriodOpen(true)}
            />
            {/* Вторая дверь — точные даты, как в шапке «Финансов»: без неё
                произвольный «С–До» (1–15 число, «выпиши мне квартал») на
                единственном экране с выпиской был недостижим. */}
            <NavRow
              label="Даты"
              value={periodDates(period)}
              separated
              onPress={() => setWheelsOpen(true)}
            />
            {periodColumn}
          </RowGroup>
          {columnMismatch ? (
            <RowCaption tone="warning" text="Не сходится с текущим остатком" />
          ) : null}

          {/* БЛОКА «КТО ПРИНЁС ДЕНЬГИ» ЗДЕСЬ НЕТ. Он отвечал на вопрос,
              который задавал только ОБЩИЙ счёт: у счёта нескольких команд надо
              было видеть, чья выручка внутри. Счёт принадлежит одной команде
              (владелец 2026-08-15) — ответ известен из заголовка. */}
          <View style={{ marginTop: 8 }}>{feed}</View>
        </View>

        {/* Выписка — единственный формат, который бухгалтер сводит с банком:
            остаток на начало, движения (включая переводы), остаток на конец. */}
        <RowGroup>
          <ActionRow
            label="Выгрузить выписку"
            dimmed={!totals || stale}
            onPress={() => void exportStatement()}
          />
        </RowGroup>
        {/* Погашенная строка обязана назвать причину сама (§8): молчащая
            серая строка читается как поломка продукта. */}
        {stale ? (
          <RowCaption text="Меняется период — выписка соберётся по свежему срезу." />
        ) : !totals ? (
          <RowCaption
            text={
              online
                ? "Выписка соберётся, когда сервер посчитает период."
                : "Выписке нужен посчитанный период — он появится, когда будет связь."
            }
          />
        ) : null}
      </ScrollView>

      <PeriodPresetModal
        visible={periodOpen}
        current={period}
        businessNow={businessNow}
        onClose={() => setPeriodOpen(false)}
        onApply={setPeriod}
      />
      <PeriodWheelsModal
        visible={wheelsOpen}
        current={period}
        onClose={() => setWheelsOpen(false)}
        onApply={setPeriod}
      />

      <TransferSheet
        visible={transferOpen}
        onClose={() => setTransferOpen(false)}
        accounts={activeAccounts}
        teamById={teamById}
        presetFromId={account.id}
      />

      <CashCountSheet
        visible={countOpen}
        onClose={() => setCountOpen(false)}
        account={account}
        subtitle={subtitle}
      />

      <TransactionPopup
        visible={!!popupTx}
        transaction={popupTx}
        accounts={accounts}
        teams={teams}
        categories={categories}
        alreadyRefunded={
          popupTx
            ? refundTotals
              ? refundTotals.get(popupTx.id) ?? 0
              : Number.POSITIVE_INFINITY
            : 0
        }
        onClose={() => setPopupTx(null)}
        onInvoice={(tx) => {
          setPopupTx(null);
          openTransactionInvoice(tx);
        }}
        onClientOpen={(clientId) => {
          setPopupTx(null);
          router.push(`/clients/${clientId}`);
        }}
        onDelete={async (tx) => {
          await delTx.mutateAsync(tx.id);
        }}
        onRefund={handleRefund}
      />

      <OperationSheet
        visible={opOpen}
        // `editingTx` НЕ обнуляется здесь: шапка мигала «Операция» → «Новая
        // операция», пока лист уезжал; открывающие пути сами ставят нужное
        // (тот же приём, что на «Финансах»).
        onClose={() => setOpOpen(false)}
        defaultTeamId={account.scope === "team" ? account.brigade_id : null}
        defaultAccountId={account.id}
        businessToday={businessToday}
        transaction={editingTx}
        onInvoice={(tx) => {
          setOpOpen(false);
          openTransactionInvoice(tx);
        }}
        onClientOpen={(clientId) => {
          setOpOpen(false);
          router.push(`/clients/${clientId}`);
        }}
        onRefund={(tx) => {
          setOpOpen(false);
          setTimeout(() => setPopupTx(tx), SHEET_EXIT_MS);
        }}
        refundedTotal={editingTx ? refundTotals?.get(editingTx.id) ?? 0 : 0}
      />
    </Screen>
  );
}

export default function AccountDetailScreen() {
  return <AccountDetailContent />;
}
