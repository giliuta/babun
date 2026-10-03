import { useMemo, useState, type ReactElement } from "react";
import {
  SectionList,
  Text,
  View,
  type RefreshControlProps,
} from "react-native";
import { money } from "@babun/shared/common/utils/money";
import type {
  InvoiceLedger,
  InvoicePaymentLedger,
} from "@babun/shared/local/finance/invoice-ledger";
import type { Receipt } from "@babun/shared/local/finance/receipt";
import type { Appointment } from "@babun/shared/local/appointments";
import type { Client } from "@babun/shared/local/clients";
import { Receipt as ReceiptIcon, ReceiptText } from "lucide-react-native";
import { EmptyState } from "@/components/ui/EmptyState";
import { SELECT_SIDE, SelectRow } from "@/components/ui/select-rows";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useThemeColors } from "@/theme/colors";
import { humanDayYear } from "@/features/appointments/helpers";
import { ReceiptSheet } from "@/features/documents/ReceiptSheet";
import type { AccountWithBalance } from "./accounts";
import type { DocumentsReadable } from "./finance-read-rules";
import { PanelHeader } from "./PanelHeader";
import type { Period } from "./period";
import { usePeriodDocuments } from "./use-period-documents";
import {
  filterDocuments,
  type DocumentFilter,
  type FinanceDocument,
} from "./documents";

// ДОКУМЕНТЫ РАСКРЫВАЮТСЯ ЗДЕСЬ, А НЕ УВОДЯТ (владелец 2026-08-11: «нажимаю
// документы — и внизу все документы сразу, чётко по порядку, по датам»).
// Раньше, чтобы увидеть инвойс, нужно было три экрана: «Финансы» →
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
   *  кнопку, которой у него нет (владелец 20.09: плашка «Документы» остаётся
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
  // Открытый чек. Своей страницы у него нет: документ неизменяем, и всё, что с
  // ним делают, — смотрят и высылают (владелец: «не надо лишних страниц»).
  const [openReceipt, setOpenReceipt] = useState<Receipt | null>(null);
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
  // Строка списка знает только id — сам чек нужен листу целиком (снимки
  // сторон, НДС, способ оплаты), и второй раз собирать его из строки нельзя.
  const receiptById = useMemo(
    () => new Map((receipts ?? []).map((r) => [r.id, r])),
    [receipts],
  );

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
        // Число в каждой вкладке (аудит 2026-09-29): плитка «Документы» —
        // сумма вкладок, и без чисел «16» над одним инвойсом читалось ошибкой.
        options={SEGMENTS.map((segment) => ({
          ...segment,
          label: `${segment.label} ${documents.filter((d) => d.kind === segment.value).length}`,
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

  return (
    <>
      <SectionList
        style={{ flex: 1 }}
        sections={sections}
        refreshControl={refreshControl}
        keyExtractor={(doc) => `${doc.kind}-${doc.id}`}
        contentContainerStyle={{ paddingBottom: 96, flexGrow: 1 }}
        // ДЕНЬ — ЗАГОЛОВОК, А НЕ ХВОСТ СТРОКИ (владелец 2026-08-15: «дата как в
        // расходах и доходах»). Ровно та же шапка, что у ленты операций: дата
        // прописью, капсом, на цвете холста. Итога дня здесь нет намеренно —
        // инвойс и чек по одним деньгам сложились бы в двойную сумму.
        // День — подписью над плашками, как в «Истории» и «Файлах» клиента
        // (владелец 03.10, вариант 2).
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
        renderItem={({ item }) => (
          <View style={{ paddingHorizontal: SELECT_SIDE }}>
            <DocumentRow
              document={item}
              onPress={() => {
                // Инвойс — документ, который правят (сумма, срок, оплата), и он
                // открывается своей страницей. Чек править нечем: он открывается
                // листом прямо здесь.
                if (item.kind === "invoice") {
                  onOpen(`/invoices/${item.id}`);
                  return;
                }
                const receipt = receiptById.get(item.id);
                if (receipt) setOpenReceipt(receipt);
              }}
            />
          </View>
        )}
        ListEmptyComponent={
          <EmptyState
            title={
              searching
                ? "Ничего не найдено"
                : filter === "invoice"
                  ? "Инвойсов за период нет"
                  : "Чеков за период нет"
            }
            // ПУСТО — ОДНОЙ СТРОКОЙ (закон 15.09, владелец 03.10): кнопка
            // внизу и так говорит, как выставить документ.
            subtitle={
              searching
                ? "Искали среди документов выбранного периода"
                : undefined
            }
          />
        }
      />
      <ReceiptSheet
        receipt={openReceipt}
        appointment={
          openReceipt?.appointment_id
            ? (appointments.find((a) => a.id === openReceipt.appointment_id) ??
              null)
            : null
        }
        accountName={
          accounts.find((a) => a.id === openReceipt?.account_id)?.name ?? null
        }
        onClose={() => setOpenReceipt(null)}
        onOpen={onOpen}
      />
    </>
  );
}

/** ДОКУМЕНТ — ПЛАШКОЙ, КАК ФАЙЛ КЛИЕНТА (владелец 03.10, вариант 2): слева
 *  плитка инвойса или чека, номер — названием, кому выдан — подписью;
 *  справа сумма и состояние словом. Погашенный документ гаснет, но стоит:
 *  номер занят, и проверяющий должен видеть почему. */
function DocumentRow({
  document,
  onPress,
}: {
  document: FinanceDocument;
  onPress: () => void;
}) {
  const t = useThemeColors();
  const invoice = document.kind === "invoice";
  return (
    <View style={{ opacity: document.dead ? 0.55 : 1 }}>
      <SelectRow
        icon={invoice ? ReceiptIcon : ReceiptText}
        // Чек — деньги уже пришли (зелёный, как на карточке клиента);
        // инвойс — документ к оплате (акцент).
        color={invoice ? t.accent : t.success}
        plain
        title={document.title}
        // Даты здесь нет: её называет заголовок дня над плашкой.
        subtitle={document.clientName || undefined}
        accessibilityLabel={[
          document.title,
          document.clientName,
          money(document.amount, document.currency),
          document.state,
        ]
          .filter(Boolean)
          .join(", ")}
        onPress={onPress}
        trailing={
          <View style={{ alignItems: "flex-end", flexShrink: 0 }}>
            <Text
              maxFontSizeMultiplier={1.3}
              numberOfLines={1}
              style={{
                fontSize: 15,
                fontWeight: "700",
                color: t.ink,
                fontVariant: ["tabular-nums"],
              }}
            >
              {money(document.amount, document.currency)}
            </Text>
            {/* СОСТОЯНИЕ ГОВОРИТ СЛОВОМ, А НЕ ЦВЕТОМ (владелец 2026-08-15:
                «неоплаченный документ — ничего страшного»). */}
            {document.state ? (
              <Text
                maxFontSizeMultiplier={1.3}
                style={{ fontSize: 13, color: t.caption }}
              >
                {document.state}
              </Text>
            ) : null}
          </View>
        }
      />
    </View>
  );
}
