import { useCallback, useMemo, useState, type ReactElement } from "react";
import {
  Pressable,
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
import { EmptyState } from "@/components/ui/EmptyState";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useThemeColors } from "@/theme/colors";
import { humanDay } from "@/features/appointments/helpers";
import { useReceipts } from "@/features/documents/receipts-queries";
import { ReceiptSheet } from "@/features/documents/ReceiptSheet";
import type { AccountWithBalance } from "./accounts";
import { PanelHeader } from "./PanelHeader";
import type { Period } from "./period";
import {
  collectDocuments,
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
  filter: DocumentFilter;
  onFilterChange: (filter: DocumentFilter) => void;
  onOpen: (href: string) => void;
  /** Pull-to-refresh хозяина экрана (U86) — один жест на все панели. */
  refreshControl?: ReactElement<RefreshControlProps>;
}) {
  const t = useThemeColors();
  // Чеки нужны ТОЛЬКО этой панели — и грузятся вместе с ней: пока её не
  // открыли, экран денег не тратит на них сетевой запрос.
  const receiptsQuery = useReceipts(clientId ? { clientId } : undefined);
  // Открытый чек. Своей страницы у него нет: документ неизменяем, и всё, что с
  // ним делают, — смотрят и высылают (владелец: «не надо лишних страниц»).
  const [openReceipt, setOpenReceipt] = useState<Receipt | null>(null);

  const clientName = useMemo(
    () => new Map(clients.map((c) => [c.id, c.full_name])),
    [clients],
  );
  // Команды у чека в базе нет вовсе — её знает то, за что он выдан: инвойс
  // (у него есть brigade_id), запись (team_id) и, для ручного прихода, счёт,
  // на который легли деньги. Счёт нескольких команд не называет ни одну и
  // потому в карту не попадает.
  const invoiceTeam = useMemo(
    () => new Map(invoices.map((i) => [i.id, i.brigade_id])),
    [invoices],
  );
  const appointmentTeam = useMemo(
    () => new Map(appointments.map((a) => [a.id, a.team_id])),
    [appointments],
  );
  const accountTeam = useMemo(
    () =>
      new Map(
        accounts
          .filter((a) => a.scope === "team" && a.brigade_id)
          .map((a) => [a.id, a.brigade_id]),
      ),
    [accounts],
  );
  const receiptTeamId = useCallback(
    (receipt: Receipt): string | null =>
      (receipt.invoice_id ? invoiceTeam.get(receipt.invoice_id) : null) ??
      (receipt.appointment_id
        ? appointmentTeam.get(receipt.appointment_id)
        : null) ??
      (receipt.account_id ? accountTeam.get(receipt.account_id) : null) ??
      null,
    [accountTeam, appointmentTeam, invoiceTeam],
  );

  const receipts = receiptsQuery.data;
  const documents = useMemo(
    () =>
      collectDocuments({
        invoices,
        payments,
        receipts: receipts ?? [],
        clientName: (id) => (id ? (clientName.get(id) ?? null) : null),
        receiptTeamId,
        period: { from: period.from, to: period.to },
        teamId,
        today,
      }),
    [
      clientName,
      invoices,
      payments,
      period.from,
      period.to,
      receiptTeamId,
      receipts,
      teamId,
      today,
    ],
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
        options={SEGMENTS}
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
        renderSectionHeader={({ section }) => (
          <View
            className="flex-row items-center px-4 py-1.5"
            style={{ backgroundColor: t.canvas }}
          >
            <Text
              className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: t.sub }}
            >
              {humanDay(section.title)}
            </Text>
          </View>
        )}
        ListHeaderComponent={header}
        ItemSeparatorComponent={() => (
          <View className="ml-4 h-px" style={{ backgroundColor: t.separator }} />
        )}
        renderItem={({ item }) => (
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
            subtitle={
              searching
                ? "Искали среди документов выбранного периода"
                : filter === "invoice"
                  ? "Инвойс выставляется кнопкой внизу — по записи или отдельно"
                  : "Чек выписывается сам, как только вы примете оплату от клиента"
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

/** Строка документа: слева тип, номер и кому выдан, справа сумма и состояние.
 *  Состояние молчит у выданного чека — он ничего не ждёт. */
function DocumentRow({
  document,
  onPress,
}: {
  document: FinanceDocument;
  onPress: () => void;
}) {
  const t = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[
        document.title,
        document.clientName,
        money(document.amount, document.currency),
        document.state,
      ]
        .filter(Boolean)
        .join(", ")}
      className="flex-row items-center gap-3 px-4 py-2.5 active:opacity-60"
      style={{
        backgroundColor: t.surface,
        minHeight: 60,
        // Погашенный документ не прячется: номер занят, и проверяющий должен
        // видеть, почему. Он гаснет — ровно как в ленте чеков.
        opacity: document.dead ? 0.55 : 1,
      }}
    >
      <View className="min-w-0 flex-1">
        <Text
          className="text-[15px] font-semibold"
          style={{ color: t.ink }}
          numberOfLines={1}
        >
          {document.title}
        </Text>
        {/* Даты здесь нет: её называет заголовок дня над строкой. Повторять её
            в каждой строке — то же самое, что писать год в каждой ячейке
            календаря. */}
        <Text
          className="mt-0.5 text-[13px]"
          style={{ color: t.sub }}
          numberOfLines={1}
        >
          {document.clientName}
        </Text>
      </View>
      <View className="items-end">
        <Text
          className="text-[15px] font-bold"
          style={{ color: t.ink, fontVariant: ["tabular-nums"] }}
        >
          {money(document.amount, document.currency)}
        </Text>
        {/* СОСТОЯНИЕ ГОВОРИТ СЛОВОМ, А НЕ ЦВЕТОМ (владелец 2026-08-15:
            «неоплаченный документ — ничего страшного, не надо выставлять его
            якобы красным»). «Просрочен» краснело и превращало обычный
            неоплаченный счёт в тревогу; само слово сказано, и этого хватает. */}
        {document.state ? (
          <Text className="mt-0.5 text-xs" style={{ color: t.caption }}>
            {document.state}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
