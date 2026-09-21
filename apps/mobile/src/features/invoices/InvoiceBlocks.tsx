import { useMemo, useState, type ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { Client } from "@babun/shared/local/clients";
import {
  invoiceLineTotal,
  type InvoiceVatMode,
} from "@babun/shared/local/finance/invoice-ledger";
import { accountsForTeam } from "@babun/shared/local/finance/integrity";
import { isServiceAllowedForTeam } from "@/features/appointments/booking-selection";
import type { TxVatMode } from "@babun/shared/local/finance/vat";
import { FieldRow, NavRow } from "@/components/ui/card-rows";
import { SectionCard } from "@/components/ui/SectionCard";
import { ClientBlock } from "@/features/appointments/ClientBlock";
import { ServicePicker } from "@/features/appointments/BookingPickers";
import { ServicesBlock } from "@/features/appointments/ServicesBlock";
import { TotalSheet } from "@/features/appointments/TotalSheet";
import { PaymentTile, TILE_GAP, useTileWidth } from "@/features/appointments/PaymentTiles";
import { ClientPickerSheet } from "@/features/clients/ClientPickerSheet";
import { accountIcon } from "@/features/finances/account-ui";
import { useAccountsWithBalances } from "@/features/finances/accounts";
import type { Service } from "@/features/services/queries";
import { useThemeColors } from "@/theme/colors";
import { InvoiceDateRow } from "./InvoiceDateRow";
import { InvoiceRequisitesBlock } from "./InvoiceRequisitesBlock";
import { parseDecimal, parseMoneyAmount, type EditableInvoiceLine } from "./format";

// ИНВОЙС — ИЗ ТЕХ ЖЕ БЛОКОВ, ЧТО ЗАПИСЬ И ЧЕК.
//
// Владелец 2026-09-20, дословно: «твоя задача по сути перенести туда блок
// услуг, перенести туда блок клиента, перенести туда время и сделать блок
// реквизиты… также выбор счёта, куда должны зачисляться деньги, также выбор
// даты, за какой промежуток времени должны оплатить… после того я нажимаю
// выставить инвойс — сначала делается превью этого инвойса, и потом я нажимаю
// сохранить».
//
// До этого форма счёта была АНКЕТОЙ: «Получатель» строкой-значением, «Даты»,
// «Позиции», отдельный блок «Налог» с сегментом и полем ставки, «Комментарий».
// Те же вопросы, но своим диалектом — у записи и чека на них отвечают блоками.
// Здесь своей разметки нет вовсе: клиент — `ClientBlock`, позиции вместе с
// «Итого» — `ServicesBlock`, деньги — `TotalSheet`, счёт — плитки
// `PaymentTile`, реквизиты — та же строка и тот же лист, что в чеке.
//
// ЧЕГО У ИНВОЙСА НЕТ. Скидки (сервер не знает такого поля у счёта) и команды в
// блоках: команду документ наследует от заявки или чипа и не спрашивает.

export interface InvoiceBlocksTotals {
  /** Что заплатит клиент — её показывает строка «Итого» блока услуг. */
  total: number;
}

export function InvoiceBlocks({
  clients,
  clientId,
  onClientChange,
  issuedOn,
  dueOn,
  issuedOnLocked,
  onIssuedOnChange,
  onDueOnChange,
  companyId,
  onCompanyChange,
  teamId,
  accountId,
  onAccountChange,
  lines,
  currency,
  services,
  onLineChange,
  onAddLine,
  onRemoveLine,
  vatMode,
  vatRate,
  onVatModeChange,
  totals,
  notes,
  onNotesChange,
  footer,
}: {
  clients: Client[];
  clientId: string | null;
  onClientChange: (id: string | null) => void;
  issuedOn: string;
  dueOn: string | null;
  /** У выставленного счёта дата рождения не меняется: по её году живёт номер. */
  issuedOnLocked?: boolean;
  /** `null` барабан даты выставления не отдаёт (строка не `optional`), но тип
   *  общий на обе даты — так его принимает `InvoiceDateRow`. */
  onIssuedOnChange: (ymd: string | null) => void;
  onDueOnChange: (ymd: string | null) => void;
  companyId: string | null;
  onCompanyChange: (id: string | null) => void;
  /** Команда документа — от неё зависит, ЧЬИ кассы показывать. */
  teamId: string | null;
  accountId: string | null;
  onAccountChange: (id: string | null) => void;
  lines: readonly EditableInvoiceLine[];
  currency: string;
  services: Service[];
  onLineChange: (line: EditableInvoiceLine) => void;
  onAddLine: (service: Service | null) => void;
  onRemoveLine: (line: EditableInvoiceLine) => void;
  vatMode: InvoiceVatMode;
  vatRate: number;
  onVatModeChange: (mode: InvoiceVatMode) => void;
  totals: InvoiceBlocksTotals;
  notes: string;
  onNotesChange: (next: string) => void;
  /** Действие экрана рисует маршрут: у экрана оно одно и живёт в футере. */
  footer?: ReactNode;
}) {
  const t = useThemeColors();
  const router = useRouter();
  const accounts = useAccountsWithBalances();
  const tileWidth = useTileWidth();
  const [sheet, setSheet] = useState<"client" | "services" | "total" | null>(null);

  const client = clients.find((c) => c.id === clientId) ?? null;
  // ЗАКРЫТЫЙ СЧЁТ В СПИСКЕ — ТУПИК: сервер его всё равно отобьёт
  // (`assert_invoice_account`), а плитка обещает. Тот же фильтр, что у листа
  // оплаты инвойса.
  const openAccounts = accountsForTeam(accounts.data ?? [], teamId).filter(
    (account) => account.is_active,
  );
  // ПРАЙС — КОМАНДЫ, А НЕ ВСЕЙ КОМПАНИИ (владелец 2026-09-21: «услуги,
  // которые предоставлены, они будут подтягиваться уже с команды»). Правило
  // одно на продукт — то же, что в записи: `isServiceAllowedForTeam`. Без
  // команды каталог ПУСТ, а не «весь»: чужой прайс в счёте — приглашение
  // выставить работу, которой эта команда не делает.
  const teamServices = useMemo(
    () => services.filter((service) => isServiceAllowedForTeam(service, teamId)),
    [services, teamId],
  );
  // ВЫБОР УСЛУГ — ТОТ ЖЕ, ЧТО В ЗАПИСИ (владелец 2026-09-22: «удали этот
  // блок услуг и добавь тот, который мы постоянно используем… не могу выбрать
  // количество»). Выбор знает услугу по id: строка инвойса помнит, из какой
  // она услуги (`serviceId`), и количество правится степпером прямо в списке.
  const serviceLines = lines.filter((line) => line.serviceId);
  const selectedServiceIds = serviceLines.map((line) => line.serviceId as string);
  const quantities = Object.fromEntries(
    serviceLines.map((line) => [line.serviceId as string, parseDecimal(line.qty) ?? 1]),
  );
  const toggleService = (id: string) => {
    const existing = lines.find((line) => line.serviceId === id);
    if (existing) {
      onRemoveLine(existing);
      return;
    }
    const service = teamServices.find((item) => item.id === id);
    if (service) onAddLine(service);
  };
  const setServiceQty = (id: string, qty: number) => {
    const line = lines.find((item) => item.serviceId === id);
    if (!line) {
      if (qty > 0) toggleService(id);
      return;
    }
    if (qty <= 0) onRemoveLine(line);
    else onLineChange({ ...line, qty: String(qty) });
  };

  // ПЕРЕВОД «ПОЗИЦИЯ СЧЁТА → СТРОКА БЛОКА» — ОДИН НА ЭКРАН: его читают и блок
  // «Позиции», и шторка «Итого». Числа позиции лежат СТРОКАМИ, пока их правят
  // руками (иначе каретка прыгает в конец), и разбираются здесь — в одном
  // месте, теми же функциями, которыми их разберёт отправка на сервер.
  const blockLines = useMemo(
    () =>
      lines.map((line) => {
        const qty = parseDecimal(line.qty) ?? 0;
        const price = parseMoneyAmount(line.unitPrice) ?? 0;
        return {
          id: line.id,
          name: line.title.trim() || "Услуга",
          // Вторая строка у позиции — что входит в работу, а не длительность:
          // у счёта нет минут.
          subtitle: line.description?.trim() || null,
          qty,
          unit: line.unit ?? null,
          pricePerUnit: price,
          // ОДИН СЧЁТ НА ВЕСЬ ПРОДУКТ (`invoiceLineTotal`): своё
          // `round(qty * price * 100) / 100` в double печатало в карточке
          // позиции €3,01 там, где бумага, PDF и сервер считают €3,02.
          total: invoiceLineTotal(qty, price),
        };
      }),
    [lines],
  );
  /** Сумма строк КАК ЕЁ НАБРАЛ ЧЕЛОВЕК — вход для канона налога. */
  const linesSum = useMemo(
    () => blockLines.reduce((sum, line) => sum + line.total, 0),
    [blockLines],
  );

  /** Правка числа возвращается в позицию СТРОКОЙ — той же, какую набрал бы
   *  человек: у позиции числа хранятся текстом, и превращать их в `1.0000001`
   *  на обратном пути нельзя. */
  const writeNumber = (id: string, field: "qty" | "unitPrice", value: number) => {
    const line = lines.find((item) => item.id === id);
    if (!line) return;
    onLineChange({ ...line, [field]: String(Number(value.toFixed(field === "qty" ? 3 : 2))) });
  };

  return (
    <>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <InvoiceRequisitesBlock companyId={companyId} onCompanyChange={onCompanyChange} />

        {/* ДВЕ ДАТЫ ОДНИМ БЛОКОМ: когда выставлен и до какого числа ждём
            денег. Вторая — просьба владельца «выбор даты, за какой промежуток
            времени должны оплатить». */}
        <SectionCard title="Даты">
          {issuedOnLocked ? (
            <NavRow label="Выставлен" value={issuedOn} onPress={undefined} />
          ) : (
            <InvoiceDateRow label="Выставлен" value={issuedOn} onChange={onIssuedOnChange} />
          )}
          <InvoiceDateRow
            label="Оплатить до"
            value={dueOn}
            optional
            separated
            minimum={issuedOn}
            onChange={onDueOnChange}
          />
        </SectionCard>

        {/* КЛИЕНТ — ТОТ ЖЕ БЛОК, ЧТО В ЗАПИСИ И ЧЕКЕ. Клиентом может быть и
            компания: владелец 2026-09-20 про Ольгу и её фирму — «инвойс
            выставляется на клиента, клиент может быть компанией», и отдельного
            блока для компании быть не должно. */}
        <ClientBlock
          client={client}
          onPick={() => setSheet("client")}
          onOpenCard={() => setSheet("client")}
          onClear={client ? () => onClientChange(null) : undefined}
        />

        {/* УСЛУГИ И «ИТОГО» — ТОТ ЖЕ БЛОК, ЧТО В ЗАПИСИ И В ЧЕКЕ, с той же
            шапкой (владелец 2026-09-21: «я бы назвал целый блок услуги»). Тап
            по услуге правит ЕЁ — название, описание, количество, цену;
            «Добавить услугу» открывает прайс, и там же «Своя услуга» —
            разовая, только в этот счёт. «Итого» открывает деньги. */}
        <ServicesBlock
          title="Услуги"
          lines={blockLines}
          total={totals.total}
          custom={false}
          discountAmount={0}
          onPickServices={() => setSheet("services")}
          onOpenTotal={() => setSheet("total")}
        />

        {/* СЧЁТ — ДЛЯ СЕБЯ, А НЕ ДЛЯ КЛИЕНТА (владелец 2026-09-21: «выбор
            счёта это уже лично для себя… оно не будет попадать в сам инвойс,
            это только для сохранения данных в финансах»). Поэтому он стоит
            ПОСЛЕДНИМ — после всего, что уйдёт клиенту, — и на бумаге его нет
            ни строкой. Плитки те же, что в записи и в чеке.
            СРАЗУ ПОСЛЕ «ИТОГО», как оплата в записи (владелец 2026-09-22):
            счета — команды, их набор меняется вместе с лентой команд. */}
        <SectionCard title="Счёт">
          {openAccounts.length > 0 ? (
            <View
              className="flex-row flex-wrap"
              style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10, gap: TILE_GAP }}
            >
              {openAccounts.map((a) => (
                <PaymentTile
                  key={a.id}
                  icon={accountIcon(a)}
                  label={a.name}
                  color={a.color ?? t.ink}
                  tint={a.color}
                  width={tileWidth}
                  compact
                  state="idle"
                  selected={accountId === a.id}
                  onPress={() => onAccountChange(accountId === a.id ? null : a.id)}
                  accessibilityLabel={`Счёт: ${a.name}`}
                />
              ))}
            </View>
          ) : (
            <Text className="px-4 py-3 text-sm" style={{ color: t.faint }}>
              У этой команды нет счёта — заведите его в «Счетах», иначе деньги
              по этому инвойсу некуда будет записать.
            </Text>
          )}
        </SectionCard>

        {/* ПРИМЕЧАНИЕ — ОДНА ПОДПИСЬ, А НЕ ДВЕ: шапка блока и подсказка поля
            называли одно и то же дважды («Комментарий» + «Примечание для
            инвойса»). Печатается внизу бумаги, как «Notes» у AirFix #103. */}
        <SectionCard title="Примечание">
          <FieldRow
            label="Примечание"
            hideLabel
            stacked
            live
            multiline
            value={notes}
            placeholder="Примечание для клиента"
            onSave={onNotesChange}
          />
        </SectionCard>

      </ScrollView>
      {footer}

      <ClientPickerSheet
        visible={sheet === "client"}
        selectedId={clientId}
        onCreate={(prefill) => {
          setSheet(null);
          router.push({ pathname: "/client", params: { id: "new", ...prefill } });
        }}
        onSelect={(picked) => {
          onClientChange(picked.id);
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
      />


      <ServicePicker
        visible={sheet === "services"}
        onClose={() => setSheet(null)}
        services={teamServices}
        selectedIds={selectedServiceIds}
        date={issuedOn}
        teamId={teamId}
        onToggle={toggleService}
        quantities={quantities}
        onQtyChange={setServiceQty}
      />

      {/* ДЕНЬГИ СЧЁТА — ТА ЖЕ ШТОРКА, ЧТО У ЗАПИСИ И ЧЕКА. Скидки в ней нет:
          у счёта её не знает сервер. Налог приходит сюда и возвращается
          обратно — шторка его не включает сама. */}
      <TotalSheet
        visible={sheet === "total"}
        onClose={() => setSheet(null)}
        lines={blockLines}
        onQtyChange={(id, qty) => writeNumber(id, "qty", qty)}
        onPriceChange={(id, price) => writeNumber(id, "unitPrice", price)}
        // СЫРАЯ СУММА СТРОК, А НЕ НЕТТО. `applyTxVat` внутри шторки
        // трактует вход как «то, что человек набрал руками»: при «налог
        // сверху» это нетто, при «налог в цене» — уже брутто. Нетто из
        // `calculateInvoiceTotals` в режиме «в цене» уже очищено от налога, и
        // шторка снимала его ВТОРОЙ раз: счёт на €119 показывал «К оплате
        // €99,99». Чек передаёт сюда ровно так же — сырую сумму.
        total={linesSum}
        vat={{
          // «off» у счёта и «none» у операции — одно и то же слово на двух
          // диалектах; канон считает налог по `TxVatMode`.
          mode: vatMode === "off" ? "none" : vatMode,
          rate: vatRate,
          onModeChange: (next: TxVatMode) =>
            onVatModeChange(next === "none" ? "off" : next),
        }}
      />
    </>
  );
}
