import { useMemo, useState, type ReactElement } from "react";
import {
  SectionList,
  Text,
  View,
  type RefreshControlProps,
} from "react-native";
import {
  calculateInvoiceSettlement,
  type InvoiceLedger,
  type InvoicePaymentLedger,
} from "@babun/shared/local/finance/invoice-ledger";
import type { Appointment } from "@babun/shared/local/appointments";
import type { Client } from "@babun/shared/local/clients";
import {
  Banknote,
  ExternalLink,
  ReceiptText,
  Share2,
  Trash2,
} from "lucide-react-native";
import { EmptyState } from "@/components/ui/EmptyState";
import { SwipeRow } from "@/components/ui/SwipeRow";
import { SETTINGS_TILE } from "@/components/ui/settings-tiles";
import { ActionMenuSheet, type ActionMenu } from "@/components/blocks/ActionMenuSheet";
import { useReceiptMenu } from "@/features/finances/receipt-menu";
import { useDocumentWriter } from "@/session/document-rights";
import { invoiceDeleteBlock } from "@/features/finances/invoice-delete";
import { useInvoiceMenu } from "@/features/finances/invoice-menu";
import { receiptRefusal } from "@/lib/receipt-eligibility";
import { SELECT_SIDE } from "@/components/ui/select-rows";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useThemeColors } from "@/theme/colors";
import { humanDayYear } from "@/features/appointments/helpers";
import type { AccountWithBalance } from "./accounts";
import type { DocumentsReadable } from "./finance-read-rules";
import { PanelHeader } from "./PanelHeader";
import type { Period } from "@/lib/period";
import { usePeriodDocuments } from "./use-period-documents";
import {
  filterDocuments,
  type DocumentFilter,
  type FinanceDocument,
} from "./documents";
import { DocumentRow } from "./documents-panel/DocumentRow";

// ДОКУМЕНТЫ РАСКРЫВАЮТСЯ ЗДЕСЬ, А НЕ УВОДЯТ: внизу все документы сразу, чётко по
// порядку, по датам. Иначе, чтобы увидеть инвойс, нужно три экрана: «Финансы» →
// «Документы» → «Инвойсы».
//
// Срез тот же, что у денег: выбранная команда и выбранный период — иначе под
// одной шапкой лежали бы два разных ответа.

const SEGMENTS = [
  { value: "invoice", label: "Инвойсы" },
  { value: "receipt", label: "Чеки" },
] as const satisfies readonly { value: DocumentFilter; label: string }[];

export function DocumentsPanel({
  invoices,
  payments,
  appointments,
  accounts,
  clients,
  clientId,
  teamId,
  period,
  today,
  query,
  canIssue = true,
  readable,
  filter,
  onFilterChange,
  onOpen,
  refreshControl,
}: {
  invoices: InvoiceLedger[];
  /** Проводки по инвойсам, ключ — invoice_id. */
  payments: Record<string, InvoicePaymentLedger[]>;
  appointments: Appointment[];
  accounts: AccountWithBalance[];
  clients: Client[];
  /** Режим «Финансы клиента»: чеки грузим сразу его, как и остальной экран. */
  clientId?: string;
  teamId: string | null;
  period: Period;
  today: string;
  /** Поиск из шапки экрана: пока панель открыта, он ищет по документам. */
  query: string;
  /** Выбранный вид документа. Живёт НА ЭКРАНЕ, а не здесь: от него зависит
   *  главная кнопка внизу («Выставить инвойс» / «Принять оплату»), а она вне
   *  панели. */
  /** Может ли человек выставить документ. Нет — пустая панель не обещает
   *  кнопку, которой у него нет (плашка «Документы» остаётся
   *  и без доступа, но внутри просто ничего не показывается). */
  canIssue?: boolean;
  /** Что человеку видно — тот же отбор, что у плитки «Документы»
   *  (`finance-read-rules.ts`): в зеркале сервер отдаёт бумаги владельца.
   *  Нет — видно всё. */
  readable?: DocumentsReadable;
  filter: DocumentFilter;
  onFilterChange: (filter: DocumentFilter) => void;
  onOpen: (href: string) => void;
  /** Pull-to-refresh хозяина экрана (U86) — один жест на все панели. */
  refreshControl?: ReactElement<RefreshControlProps>;
}) {
  const t = useThemeColors();
  const invoiceMenu = useInvoiceMenu();
  const receiptMenu = useReceiptMenu();
  const canWrite = useDocumentWriter();
  const [sheetMenu, setSheetMenu] = useState<ActionMenu | null>(null);
  // Список документов периода — общий с плиткой «Документы» на «Финансах»
  // (`usePeriodDocuments`): число на плитке и строки здесь из одного места.
  const {
    documents: issued,
    receipts,
    receiptsQuery,
  } = usePeriodDocuments({
    invoices,
    payments,
    appointments,
    accounts,
    clients,
    clientId,
    teamId,
    period,
    today,
  });
  const documents = useMemo(
    () => (readable ? readable(issued, receipts) : issued),
    [issued, readable, receipts],
  );
  const rows = useMemo(
    () => filterDocuments(documents, filter, query),
    [documents, filter, query],
  );
  // Группировка по дню выдачи. Порядок уже задан `collectDocuments` (новые
  // сверху), поэтому дни складываются в том же порядке, в каком встречаются —
  // второй сортировки не нужно, а лишняя развалила бы согласие с лентой денег.
  const sections = useMemo(() => {
    const byDate: { title: string; data: FinanceDocument[] }[] = [];
    for (const doc of rows) {
      const last = byDate[byDate.length - 1];
      if (last && last.title === doc.date) last.data.push(doc);
      else byDate.push({ title: doc.date, data: [doc] });
    }
    return byDate;
  }, [rows]);

  // Шапка одна на все ветки — загрузку, ошибку и список: сегмент не смеет
  // мигать, пока чеки в пути.
  const header = (
    <View>
      {/* Счётчика у эйбрау нет намеренно: плитка наверху считает ДРУГОЕ
          множество — документы, которые ждут оплату. Два разных числа под
          одним словом читались бы как ошибка. */}
      <PanelHeader title="Документы" />
      {/* Сегмент стоит ВСЕГДА — и у тенанта без единого чека, и пока чеки
          грузятся: он не фильтр списка, а выбор вида документа — от него
          зависит кнопка внизу экрана. Спрятать его значит спрятать и её. */}
      <SegmentedControl
        // Число в каждой вкладке: плитка «Документы» —
        // сумма вкладок, и без чисел «16» над одним инвойсом читалось ошибкой.
        // Кредит-нота стоит строкой под своим инвойсом, но документом периода
        // не считается — как у плитки: отменённый инвойс с кредит-нотой давал
        // плитку «1» и вкладку «Инвойсы 2».
        options={SEGMENTS.map((segment) => ({
          ...segment,
          label: `${segment.label} ${documents.filter((d) => d.kind === segment.value && !d.creditNote).length}`,
        }))}
        value={filter}
        onChange={onFilterChange}
        style={{ marginHorizontal: 16, marginBottom: 8 }}
      />
    </View>
  );

  // Список без половины документов — это ложь, а не неполнота: пока чеки в
  // пути, под сегментом стоит «загружаем», а не одни инвойсы.
  if (receipts === undefined) {
    return (
      <View style={{ flex: 1 }}>
        {header}
        {receiptsQuery.error ? (
          <EmptyState
            state="error"
            fill
            title="Не удалось загрузить документы"
            subtitle={(receiptsQuery.error as Error).message}
            action={{
              label: "Повторить",
              onPress: () => void receiptsQuery.refetch(),
            }}
          />
        ) : (
          <EmptyState state="loading" fill />
        )}
      </View>
    );
  }

  const searching = query.trim().length > 0;

  // ДЕЙСТВИЯ С ДОКУМЕНТОМ — ТЕ ЖЕ, ЧТО «⋯» НА ЕГО СТРАНИЦЕ:
  // долгое нажатие на чек или инвойс — шторка-менюшка. Смахнуть вправо —
  // «Удалить» (только последний в серии без денег: номер вернётся); у прочих
  // правой кромки нет.
  const invoiceById = new Map(invoices.map((item) => [item.id, item]));
  const receiptById = new Map((receipts ?? []).map((item) => [item.id, item]));
  const menuContext = (invoice: InvoiceLedger) => ({
    all: invoices,
    payments: payments[invoice.id] ?? [],
    hasReceipt: (receipts ?? []).some((receipt) => receipt.invoice_id === invoice.id),
  });
  const deleteAction = (doc: FinanceDocument) => {
    if (doc.kind !== "invoice") return null;
    const invoice = invoiceById.get(doc.id);
    if (!invoice || invoiceDeleteBlock(invoice, invoices, false) !== null) return null;
    return invoiceMenu.actionsFor(invoice, menuContext(invoice)).find((a) => a.key === "delete") ?? null;
  };
  // ПОЛНЫЙ СПИСОК, КАК У ЗАПИСИ В КАЛЕНДАРЕ: по удержанию вылезает список —
  // поделиться, принять оплату, удалить, кредит-нота…
  // «Поделиться», «Принять оплату» и «Выписать чек» открывают страницу
  // документа с этим действием — там вся их логика.
  const openMenu = (doc: FinanceDocument) => {
    const open = { label: "Открыть", icon: ExternalLink, color: SETTINGS_TILE.blue };
    const share = { label: "Поделиться PDF", icon: Share2, color: SETTINGS_TILE.teal };
    if (doc.kind === "invoice") {
      const invoice = invoiceById.get(doc.id);
      if (!invoice) return;
      const path = `/invoices/${invoice.id}`;
      const write = canWrite(invoice.brigade_id);
      const own = payments[invoice.id] ?? [];
      const settlement = calculateInvoiceSettlement(invoice, own);
      const isInvoice = (invoice.kind ?? "invoice") === "invoice";
      const awaits = isInvoice && invoice.status === "issued" && settlement.remaining > 0;
      const withReceipt = new Set(
        (receipts ?? []).flatMap((r) => (r.transaction_id ? [r.transaction_id] : [])),
      );
      // «Выписать чек» — только там, где сервер его выпустит: клиент есть,
      // оплата не возвращена целиком (`receiptRefusal`, одно правило с
      // кнопкой страницы инвойса).
      const needsReceipt =
        isInvoice &&
        receiptRefusal({ invoice, payments: own, receiptTransactionIds: withReceipt }) === null;
      setSheetMenu(
        invoiceMenu.menuFor(invoice, menuContext(invoice), [
          { ...open, run: () => onOpen(path) },
          // «Документы: Видит» — открыть и смотреть, без отправки и денег.
          ...(write ? [{ ...share, run: () => onOpen(`${path}?action=share`) }] : []),
          ...(write && awaits
            ? [{ label: "Принять оплату", icon: Banknote, color: SETTINGS_TILE.green, run: () => onOpen(`${path}?action=pay`) }]
            : []),
          ...(write && needsReceipt
            ? [{ label: "Выписать чек", icon: ReceiptText, color: SETTINGS_TILE.green, run: () => onOpen(`${path}?action=receipt`) }]
            : []),
        ]),
      );
      return;
    }
    const receipt = receiptById.get(doc.id);
    if (!receipt) return;
    const path = `/documents/receipt/${receipt.id}`;
    setSheetMenu(
      receiptMenu.menuFor(receipt, [
        { ...open, run: () => onOpen(path) },
        ...(canWrite(receipt.team_id) ? [{ ...share, run: () => onOpen(`${path}?action=share`) }] : []),
      ]),
    );
  };

  return (
    <>
      <ActionMenuSheet menu={sheetMenu} onClose={() => setSheetMenu(null)} />
      <SectionList
        style={{ flex: 1 }}
        sections={sections}
        refreshControl={refreshControl}
        keyExtractor={(doc) => `${doc.kind}-${doc.id}`}
        contentContainerStyle={{ paddingBottom: 96, flexGrow: 1 }}
        // ДЕНЬ — ЗАГОЛОВОК, А НЕ ХВОСТ СТРОКИ (дата как в
        // расходах и доходах). Ровно та же шапка, что у ленты операций: дата
        // прописью, капсом, на цвете холста. Итога дня здесь нет намеренно —
        // инвойс и чек по одним деньгам сложились бы в двойную сумму.
        // День — подписью над плашками, как в «Истории» и «Файлах» клиента.
        renderSectionHeader={({ section }) => (
          <View className="flex-row items-center px-4 pb-1.5 pt-3">
            <Text
              className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: t.sub }}
            >
              {humanDayYear(section.title)}
            </Text>
          </View>
        )}
        ListHeaderComponent={header}
        // Плашки — с воздухом между ними, без швов.
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        renderItem={({ item }) => {
          const row = (
            <DocumentRow
              document={item}
              onPress={() => {
                // Инвойс и чек — каждый своей страницей, чек в такой же архитектуре.
                onOpen(item.kind === "invoice" ? `/invoices/${item.id}` : `/documents/receipt/${item.id}`);
              }}
              onLongPress={() => openMenu(item)}
            />
          );
          const removable = deleteAction(item);
          return (
            <View style={{ paddingHorizontal: SELECT_SIDE }}>
              {removable ? (
                <SwipeRow
                  radius={t.radius.input}
                  label="Удалить"
                  color={t.danger}
                  icon={Trash2}
                  accessibilityLabel={`Удалить ${item.title}`}
                  onAction={removable.run}
                >
                  {row}
                </SwipeRow>
              ) : (
                row
              )}
            </View>
          );
        }}
        ListEmptyComponent={
          <EmptyState
            title={
              searching
                ? "Ничего не найдено"
                : filter === "invoice"
                  ? "Инвойсов за период нет"
                  : "Чеков за период нет"
            }
            // ПУСТО — ОДНОЙ СТРОКОЙ: кнопка
            // внизу и так говорит, как выставить документ.
            subtitle={
              searching
                ? "Искали среди документов выбранного периода"
                : undefined
            }
          />
        }
      />
    </>
  );
}
