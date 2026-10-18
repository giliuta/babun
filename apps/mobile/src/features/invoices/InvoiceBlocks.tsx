import { useCallback, useMemo, useState, type ReactNode } from "react";
import { ScrollView } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { takeCreatedClient } from "@/features/appointments/pending-client";
import type { Client } from "@babun/shared/local/clients";
import type { InvoiceVatMode } from "@babun/shared/local/finance/invoice-ledger";
import { isServiceAllowedForTeam } from "@/features/appointments/booking-selection";
import { FieldRow } from "@/components/ui/card-rows";
import { SectionCard } from "@/components/ui/SectionCard";
import { ClientBlock } from "@/features/appointments/ClientBlock";
import { useAppointments } from "@/features/calendar/queries";
import { buildStatsMap } from "@babun/shared/local/selectors/client-stats";
import { useClientInvoicing } from "@/features/finances/client-invoicing";
import { ServicePicker } from "@/features/appointments/BookingPickers";
import { ServicesBlock } from "@/features/appointments/ServicesBlock";
import type { DiscountKind } from "@/features/appointments/TotalSheet";
import { ClientPickerSheet } from "@/features/clients/ClientPickerSheet";
import type { Service } from "@/features/services/queries";
import { useClientFunctionOn } from "@/features/clients/client-functions";
import { useFeatureOn } from "@/features/settings/company-features";
import { InvoiceDatesBlock } from "./InvoiceDatesBlock";
import { InvoiceRequisitesBlock } from "./InvoiceRequisitesBlock";
import { InvoiceObjectBlock } from "./InvoiceObjectBlock";
import { InvoiceClientRequisitesBlock } from "./InvoiceClientRequisitesBlock";
import type { InvoiceNumberTarget } from "@/features/finances/InvoiceNumberRow";
import type { EditableInvoiceLine } from "@/lib/paper/format";
import { invoiceBlockLines, serviceSelection } from "./invoice-blocks/block-lines";
import { InvoiceTotalSheet } from "./invoice-blocks/InvoiceTotalSheet";

// ИНВОЙС — ИЗ ТЕХ ЖЕ БЛОКОВ, ЧТО ЗАПИСЬ И ЧЕК.
//
// Форма счёта не анкета («Получатель» строкой-значением, отдельный блок «Налог»
// с сегментом и полем ставки): у записи и чека на те же вопросы отвечают блоками,
// и свой диалект пришлось бы вести отдельно. Здесь своей разметки нет вовсе:
// клиент — `ClientBlock`, позиции вместе с «Итого» — `ServicesBlock`, деньги —
// `TotalSheet`, реквизиты — та же строка и тот же лист, что в чеке. Перед
// выставлением — превью бумаги, потом «Сохранить».
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
  locationId,
  onLocationChange,
  clientRequisitesId,
  onClientRequisitesChange,
  issuedOn,
  dueOn,
  onIssuedOnChange,
  onDueOnChange,
  companyId,
  onCompanyChange,
  showRequisites = true,
  number,
  companyLocked = false,
  language,
  teamId,
  lines,
  currency,
  services,
  onLineChange,
  onAddLine,
  onAddCustomLine,
  onRemoveLine,
  vatMode,
  vatRate,
  onVatModeChange,
  onVatRateChange,
  discount,
  totals,
  notes,
  onNotesChange,
  footer,
}: {
  clients: Client[];
  clientId: string | null;
  onClientChange: (id: string | null) => void;
  /** Объект клиента, под который выписан счёт. */
  locationId: string | null;
  onLocationChange: (id: string | null) => void;
  /** Набор реквизитов клиента; `null` — основной. */
  clientRequisitesId: string | null;
  onClientRequisitesChange: (id: string | null) => void;
  issuedOn: string;
  dueOn: string | null;
  /** `null` барабан даты выставления не отдаёт (строка не `optional`), но тип
   *  общий на обе даты — так его принимает `InvoiceDatesBlock`. */
  onIssuedOnChange: (ymd: string | null) => void;
  onDueOnChange: (ymd: string | null) => void;
  companyId: string | null;
  onCompanyChange: (id: string | null) => void;
  /** Блок «Реквизиты» — владельцу. Партнёр выставляет от реквизитов
   *  своей команды: выбрать или править набор он не может, сервер берёт
   *  юрлицо команды сам. */
  showRequisites?: boolean;
  /** Номер следующего инвойса реквизитов — только у нового счёта. */
  number?: InvoiceNumberTarget;
  /** Реквизиты не меняются — правка выставленного счёта (номер из их серии). */
  companyLocked?: boolean;
  /** «Язык · English» под номером — язык бумаги; шторку открывает составитель. */
  language?: { value: string; onPress?: () => void };
  /** Команда документа — от неё зависит, чей прайс предлагать. */
  teamId: string | null;
  lines: readonly EditableInvoiceLine[];
  currency: string;
  services: Service[];
  onLineChange: (line: EditableInvoiceLine) => void;
  onAddLine: (service: Service | null) => void;
  /** Своя услуга — пустая строка, её заводит «＋ Добавить» в «Итого». */
  onAddCustomLine: () => void;
  onRemoveLine: (line: EditableInvoiceLine) => void;
  vatMode: InvoiceVatMode;
  vatRate: number;
  onVatModeChange: (mode: InvoiceVatMode) => void;
  onVatRateChange: (rate: number) => void;
  /** Скидка документа — та же пара, что у записи; `amount` уже в евро. */
  discount: {
    kind: DiscountKind;
    value: string;
    amount: number;
    onKindChange: (kind: DiscountKind) => void;
    onValueChange: (value: string) => void;
  };
  totals: InvoiceBlocksTotals;
  notes: string;
  onNotesChange: (next: string) => void;
  /** Действие экрана рисует маршрут: у экрана оно одно и живёт в футере. */
  footer?: ReactNode;
}) {
  const router = useRouter();
  // Функции компании (STORY-088): выключенные объекты и реквизиты клиента не
  // спрашиваются и в инвойсе — у всех, у владельца тоже.
  const objectsOn = useFeatureOn("objects");
  const [sheet, setSheet] = useState<"client" | "services" | "total" | null>(null);

  // КЛИЕНТ, СОЗДАННЫЙ РАДИ ИНВОЙСА, ВСТАЁТ В ИНВОЙС сразу, а не остаётся прежний.
  // Тот же ящик, что у записи и чека (`pending-client.ts`): карточка кладёт id при
  // «Готово», форма забирает его, получив фокус.
  useFocusEffect(
    useCallback(() => {
      const created = takeCreatedClient();
      if (created) onClientChange(created);
      // onClientChange меняется каждый рендер; ящик и так опустошается чтением.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const client = clients.find((c) => c.id === clientId) ?? null;
  // Реквизиты клиента — функция его КОМАНДЫ.
  const requisitesOn = useClientFunctionOn("client_requisites", client?.team_id);
  // ТОТ ЖЕ БЛОК «КЛИЕНТ», ЧТО В ЗАПИСИ: сводка визитов и денег под именем, «…» в
  // карточку. Та же карта сводок кормит и шторку. Заметки клиента в инвойсе нет —
  // она здесь не нужна.
  const appointments = useAppointments();
  // Работа под инвойсом должна остаток инвойса — как в списке клиентов.
  const invoicing = useClientInvoicing();
  const statsById = useMemo(
    () => buildStatsMap(clients, appointments.data ?? [], invoicing),
    [clients, appointments.data, invoicing],
  );
  const clientStats = client ? statsById.get(client.id) : undefined;
  // ПРАЙС — КОМАНДЫ, А НЕ ВСЕЙ КОМПАНИИ: услуги подтягиваются с команды. Правило
  // одно на продукт — то же, что в записи: `isServiceAllowedForTeam`. Без
  // команды каталог ПУСТ, а не «весь»: чужой прайс в счёте — приглашение
  // выставить работу, которой эта команда не делает.
  const teamServices = useMemo(
    () => services.filter((service) => isServiceAllowedForTeam(service, teamId)),
    [services, teamId],
  );
  const { selectedServiceIds, quantities } = serviceSelection(lines);
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

  // One translation «invoice line → block line» per screen (`invoiceBlockLines`).
  const blockLines = useMemo(() => invoiceBlockLines(lines), [lines]);
  /** Сумма строк КАК ЕЁ НАБРАЛ ЧЕЛОВЕК — вход для канона налога. */
  const linesSum = useMemo(
    () => blockLines.reduce((sum, line) => sum + line.total, 0),
    [blockLines],
  );

  return (
    <>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        {showRequisites ? (
          <InvoiceRequisitesBlock
            companyId={companyId}
            onCompanyChange={onCompanyChange}
            number={number}
            locked={companyLocked}
            language={language}
          />
        ) : null}

        {/* ДВЕ ДАТЫ ОДНИМ БЛОКОМ: когда выставлен и до какого числа ждём
            денег. Вторая — просьба владельца «выбор даты, за какой промежуток
            времени должны оплатить». */}
        <InvoiceDatesBlock
          issuedOn={issuedOn}
          dueOn={dueOn}
          onIssuedOnChange={onIssuedOnChange}
          onDueOnChange={onDueOnChange}
        />

        {/* КЛИЕНТ — ТОТ ЖЕ БЛОК, ЧТО В ЗАПИСИ И ЧЕКЕ. Клиентом может быть и
            компания: инвойс выставляется на клиента, клиент может быть компанией,
            и отдельного блока для компании быть не должно. */}
        <ClientBlock
          client={client}
          stats={clientStats}
          onPick={() => setSheet("client")}
          // «…» ведёт в карточку клиента, как в записи; выбор — тапом по имени.
          onOpenCard={
            client
              ? () => router.push({ pathname: "/client", params: { id: client.id } })
              : undefined
          }
        />

        {/* ОБЪЕКТ — ПОД КЛИЕНТОМ, КАК В ЗАПИСИ: под каждый объект свой инвойс;
            его точный адрес — адрес на бумаге. */}
        {objectsOn ? (
          <InvoiceObjectBlock
            client={client}
            locationId={locationId}
            onLocationChange={onLocationChange}
          />
        ) : null}

        {/* РЕКВИЗИТЫ КЛИЕНТА — ПОСЛЕ ОБЪЕКТА, блоком как «Объект»: клиент, потом
            объект, потом реквизиты клиента; есть — выбираем, нет — добавляем. */}
        {requisitesOn ? (
          <InvoiceClientRequisitesBlock
            client={client}
            requisitesId={clientRequisitesId}
            onRequisitesChange={onClientRequisitesChange}
          />
        ) : null}

        {/* УСЛУГИ И «ИТОГО» — ТОТ ЖЕ БЛОК, ЧТО В ЗАПИСИ И В ЧЕКЕ, с той же
            шапкой.
            Услуги прайса — строками выбора (тап открывает прайс). Своя
            услуга заводится «＋ Добавить» в шапке «Итого» и правится там же.
            «Итого» открывает деньги. */}
        <ServicesBlock
          title="Услуги"
          lines={blockLines}
          total={totals.total}
          custom={false}
          discountAmount={discount.amount}
          onPickServices={() => setSheet("services")}
          onOpenTotal={() => setSheet("total")}
        />

        {/* СЧЁТА В ИНВОЙСЕ НЕТ: на бумагу он не попадает, а счёт выбирают один раз —
            когда деньги пришли, в «Принять оплату». */}
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
        statsById={statsById}
        selectedId={clientId}
        onCreate={(prefill) => {
          setSheet(null);
          router.push({ pathname: "/client", params: { id: "new", ...prefill } });
        }}
        onSelect={(picked) => {
          onClientChange(picked.id);
          setSheet(null);
        }}
        // Повторный тап по выбранному клиенту снимает его.
        onDeselect={() => {
          onClientChange(null);
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

      <InvoiceTotalSheet
        visible={sheet === "total"}
        onClose={() => setSheet(null)}
        lines={lines}
        blockLines={blockLines}
        linesSum={linesSum}
        onAddCustomLine={onAddCustomLine}
        onRemoveLine={onRemoveLine}
        onLineChange={onLineChange}
        discount={discount}
        vatMode={vatMode}
        vatRate={vatRate}
        onVatModeChange={onVatModeChange}
        onVatRateChange={onVatRateChange}
      />
    </>
  );
}
