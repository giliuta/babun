import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import type { AppointmentService, Discount } from "@babun/shared/local/appointments";
import {
  globalDiscountAmount,
  lineTotal,
  round2,
  subtotal,
} from "@babun/shared/local/finance/appointment-calc";
import { buildStatsMap } from "@babun/shared/local/selectors/client-stats";
import { DateWheelSheet } from "@/components/ui/DateWheelSheet";
import { NavRow } from "@/components/ui/card-rows";
import { SectionCard } from "@/components/ui/SectionCard";
import { ServicePicker } from "@/features/appointments/BookingPickers";
import { ServicesBlock } from "@/features/appointments/ServicesBlock";
import { ClientBlock } from "@/features/appointments/ClientBlock";
import { Building2 } from "lucide-react-native";
import { PickerSheet } from "@/components/ui/PickerSheet";
import { humanDay } from "@/features/appointments/helpers";
import { durationLabel } from "@/features/services/format";
import { takeCreatedClient } from "@/features/appointments/pending-client";
import { PaymentTile, TILE_GAP, useTileWidth } from "@/features/appointments/PaymentTiles";
import { TotalSheet, type DiscountKind } from "@/features/appointments/TotalSheet";
import type { TxVatMode } from "@babun/shared/local/finance/vat";
import { useAppointments } from "@/features/calendar/queries";
import { ClientPickerSheet } from "@/features/clients/ClientPickerSheet";
import { useClients } from "@/features/clients/queries";
import { accountIcon } from "@/features/finances/account-ui";
import { accountsForTeam } from "@babun/shared/local/finance/integrity";
import { useAccountsWithBalances } from "@/features/finances/accounts";
import { useServices, type Service } from "@/features/services/queries";
import { useCompanies, defaultCompany } from "@/features/companies/queries";
import { useRememberedVatRate } from "@/features/finances/remembered-vat-rate";
import { companyDetail } from "@/features/companies/company-rules";
import { useTenant } from "@/features/settings/tenant";
import { useThemeColors } from "@/theme/colors";
import { iconPreset } from "@/components/ui/icon-set";

// СОСТАВИТЕЛЬ ЧЕКА — ИЗ ТЕХ ЖЕ БЛОКОВ, ЧТО ЗАПИСЬ.
//
// Владелец 2026-09-20, дословно: «добавь в чек те же блоки услуг, которые уже
// добавлены… не создавай новый, а копируй; блок с услугами такой же блок, как
// в записи, итого такой же блок… не надо создавать с нуля что-то новое,
// копируй то, что мы уже создали. Выбор услуг — именно такой выбор услуг».
//
// Поэтому здесь НЕТ своей разметки блоков вовсе. Клиент — `ClientBlock`,
// услуги вместе со строкой «Итого» — `ServicesBlock`, выбор услуг —
// `ServicePicker`, шторка итогов — `TotalSheet`, время — `WhenRow` и
// `WhenSheet`, счёт — плитки `PaymentTile`. Все семь уже работали в записи и
// в форме операции; чек их СТАВИТ, а не повторяет.
//
// ЧЕГО ЗДЕСЬ НЕТ — того и у чека нет: объекта, заметки записи, команды.
//
// СТРОКА РАБОТ — ТА ЖЕ СУЩНОСТЬ (`AppointmentService`), что у записи: иначе
// «тот же блок» пришлось бы кормить переводом туда-обратно, а перевод — то
// самое место, где расходятся копейки.

export interface ReceiptDraftState {
  /** Команда, в которой выписывают чек. ВЫБОРА ЕЁ В ЧЕКЕ НЕТ (владелец
   *  2026-09-20: «выбор команды я думаю это лишнее») — она приезжает чипом с
   *  «Финансов» и молча решает одно: какие кассы показать. */
  teamId: string | null;
  clientId: string | null;
  accountId: string | null;
  /** Какими реквизитами подписан чек. `null` — берём основные: документ не
   *  должен требовать выбора там, где ответ и так известен. */
  companyId: string | null;
  /** День и время приёма денег — ровно как у операции. */
  date: string;
  lines: AppointmentService[];
  discountType: DiscountKind;
  /** Сырой текст поля скидки — разбор живёт здесь, как в записи. */
  discountValue: string;
  /** НАЛОГ ПО УМОЛЧАНИЮ ВЫКЛЮЧЕН (владелец 2026-09-20: «НДС почему-то
   *  добавляется или он включён — так не должно быть»). Настройка компании
   *  его больше НЕ включает сама: документ печатает только то, что человек
   *  выбрал клавишей в «Итого». */
  vatMode: TxVatMode;
  /** Ставка, выбранная тапом по ней в «Итого» (владелец 2026-09-22).
   *  Пусто — ставка из настроек (счёт → команда → компания). */
  vatRate?: number | null;
}

type OpenSheet = "client" | "company" | "services" | "total" | "when" | null;

export function useReceiptDraft(
  today: string,
  presetTeamId: string | null,
): [ReceiptDraftState, (next: Partial<ReceiptDraftState>) => void] {
  const [draft, setDraft] = useState<ReceiptDraftState>(() => ({
    teamId: presetTeamId,
    clientId: null,
    accountId: null,
    companyId: null,
    date: today,
    lines: [],
    discountType: "percent",
    discountValue: "",
    vatMode: "none",
  }));
  return [draft, (next) => setDraft((prev) => ({ ...prev, ...next }))];
}

/** Скидка черновика — той же сущностью `Discount`, что у записи. */
export function receiptDiscount(draft: ReceiptDraftState): Discount | null {
  const value = Number(draft.discountValue.replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return null;
  return { type: draft.discountType, value };
}

/** Итог черновика. Один расчёт на бумагу, на проводку и на строку «Итого» —
 *  теми же функциями, которыми считает запись (`appointment-calc`). */
export function receiptTotals(draft: ReceiptDraftState) {
  const discount = receiptDiscount(draft);
  const works = subtotal(draft.lines);
  const discountAmount = globalDiscountAmount(draft.lines, discount);
  return {
    works,
    discountAmount,
    total: round2(Math.max(0, works - discountAmount)),
  };
}

/** Строки чека для сервера — из тех же строк работ, что на экране. */
export function receiptLinesForServer(
  draft: ReceiptDraftState,
  nameFor: (line: AppointmentService) => string,
) {
  return draft.lines.map((line) => ({
    name: nameFor(line),
    qty: line.quantity,
    unit: line.unit ?? null,
    unitPrice: line.pricePerUnit,
    sum: lineTotal(line),
  }));
}

export function ReceiptComposer({
  draft,
  businessToday,
  onChange,
  onOpenCompany,
  footer,
}: {
  draft: ReceiptDraftState;
  /** Сегодня по часам бизнеса: дальше него чек не датируется — деньги не
   *  приходят из будущего. */
  businessToday: string;
  onChange: (next: Partial<ReceiptDraftState>) => void;
  /** Дверь в реквизиты: наборы заводят и правят там. */
  onOpenCompany: () => void;
  /** Действие экрана рисует маршрут: у экрана оно одно и живёт в футере. */
  footer?: ReactNode;
}) {
  const t = useThemeColors();
  const clients = useClients();
  const services = useServices();
  const accounts = useAccountsWithBalances();
  const appointments = useAppointments();
  const tileWidth = useTileWidth();
  const router = useRouter();
  const tenant = useTenant();
  const companies = useCompanies();
  const [sheet, setSheet] = useState<OpenSheet>(null);

  // Созданный ради чека клиент возвращается в чек: тот же ящик, что у записи.
  useFocusEffect(
    useCallback(() => {
      const created = takeCreatedClient();
      if (created) onChange({ clientId: created });
      // onChange меняется каждый рендер — брать его в зависимости значит
      // звать эффект на каждый кадр; ящик и так опустошается чтением.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const client = (clients.data ?? []).find((c) => c.id === draft.clientId) ?? null;
  // Вводная о человеке считается один раз на весь список, а не по клиенту на
  // строку — та же карта, что строит список выбора.
  const statsById = useMemo(
    () => buildStatsMap(clients.data ?? [], appointments.data ?? []),
    [appointments.data, clients.data],
  );
  const catalog = useMemo(
    () => new Map((services.data ?? []).map((s) => [s.id, s])),
    [services.data],
  );
  // Ставку пишут цифрами в «Итого» и она запоминается для следующих
  // документов (владелец 2026-09-22). Настройки ставки больше не решают, а
  // САМ НАЛОГ по-прежнему включает только человек клавишей VAT.
  const rememberedRate = useRememberedVatRate();
  const vatRate = draft.vatRate ?? rememberedRate.rate;
  const liveCompanies = (companies.data ?? []).filter((c) => !c.archived_at);
  const company =
    liveCompanies.find((c) => c.id === draft.companyId) ??
    defaultCompany(companies.data ?? []);
  const totals = receiptTotals(draft);
  // ПЕРЕВОД «РАБОТА → СТРОКА БЛОКА» — ОДИН НА ЭКРАН: его читают и блок
  // «Услуги», и шторка «Итого». Две копии разошлись бы на первой же правке.
  const blockLines = useMemo(
    () =>
      draft.lines.map((line) => ({
        id: line.serviceId,
        name: line.serviceName ?? catalog.get(line.serviceId)?.name ?? "Услуга удалена",
        subtitle: durationLabel(line.duration),
        unit: line.unit ?? catalog.get(line.serviceId)?.unit ?? null,
        qty: line.quantity,
        pricePerUnit: line.pricePerUnit,
        total: line.totalPrice,
      })),
    [catalog, draft.lines],
  );
  const openAccounts = accountsForTeam(accounts.data ?? [], draft.teamId);

  const setLines = (lines: AppointmentService[]) => onChange({ lines });

  /** Взять или снять услугу — тем же жестом, что в записи. */
  const toggleService = (id: string) => {
    if (draft.lines.some((l) => l.serviceId === id)) {
      setLines(draft.lines.filter((l) => l.serviceId !== id));
      return;
    }
    const svc = catalog.get(id);
    if (!svc) return;
    setLines([...draft.lines, newLine(svc)]);
  };

  const changeQty = (id: string, qty: number) => {
    if (qty <= 0) {
      setLines(draft.lines.filter((l) => l.serviceId !== id));
      return;
    }
    setLines(
      draft.lines.map((l) => (l.serviceId === id ? recalc(l, { quantity: qty }) : l)),
    );
  };

  const changePrice = (id: string, price: number) =>
    setLines(
      draft.lines.map((l) => (l.serviceId === id ? recalc(l, { pricePerUnit: price }) : l)),
    );

  return (
    <>
      <ScrollView
        // БЕЗ ПРОМЕЖУТКОВ МЕЖДУ БЛОКАМИ (владелец 2026-09-20): чек читается
        // одним документом, а не стопкой отдельных карточек.
        contentContainerStyle={{ paddingTop: 6, paddingBottom: 32, gap: 6 }}
        keyboardShouldPersistTaps="handled"
      >
        <ClientBlock
          client={client}
          stats={client ? statsById.get(client.id) : undefined}
          onPick={() => setSheet("client")}
          onOpenCard={() => setSheet("client")}
          onClear={client ? () => onChange({ clientId: null }) : undefined}
        />

        {/* ДАТА — СВОИМ БЛОКОМ (владелец 2026-09-20: «дата — это должен быть
            блок с выбором даты»). Часов у чека нет: деньги приняты в такой-то
            день. */}
        <SectionCard title="Дата">
          <NavRow
            label="Дата чека"
            value={humanDay(draft.date)}
            onPress={() => setSheet("when")}
          />
        </SectionCard>

        {/* РЕКВИЗИТЫ — ЧЕМ ПОДПИСАН ЧЕК. Владелец 2026-09-20 поправил слово:
            «компания — это компания, а именно реквизиты компании». Выбирают не
            юрлицо, а набор реквизитов; основной подставляется сам, а выбрать
            можно любой — тем же жестом, что выбирают услугу. */}
        <SectionCard title="Реквизиты">
          <NavRow
            label={company?.name ?? tenant.data?.legal_name ?? tenant.data?.name ?? "Компания"}
            value={company?.business_address ?? tenant.data?.business_address ?? null}
            placeholder="Реквизиты не заполнены"
            onPress={() => setSheet("company")}
          />
        </SectionCard>

        {/* УСЛУГИ И «ИТОГО» — ТОТ ЖЕ БЛОК, ЧТО В ЗАПИСИ. Про налог здесь нет
            ни слова, пока человек его не выбрал (владелец 2026-09-20: «если
            НДС не выбирается, то и в чеке ничего об этом не говорится»). */}
        <ServicesBlock
          lines={blockLines}
          total={totals.total}
          custom={false}
          discountAmount={totals.discountAmount}
          onPickServices={() => setSheet("services")}
          onOpenTotal={() => setSheet("total")}
        />

        {/* СЧЁТ — ПЛИТКАМИ, КАК В ЗАПИСИ И В ФОРМЕ ОПЕРАЦИИ (владелец
            2026-09-09: «счёт делаем так же, как в записи клиента»). */}
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
                  selected={draft.accountId === a.id}
                  onPress={() => onChange({ accountId: a.id })}
                  accessibilityLabel={`Счёт: ${a.name}`}
                />
              ))}
            </View>
          ) : (
            <Text className="px-4 py-3 text-sm" style={{ color: t.faint }}>
              {draft.teamId
                ? "У этой команды нет счёта — заведите его в «Счетах», иначе деньги некуда записать."
                : "Кассы принадлежат командам. Выберите команду чипом на «Финансах» и откройте чек заново."}
            </Text>
          )}
        </SectionCard>
      </ScrollView>
      {footer}

      {/* «ДОБАВИТЬ КЛИЕНТА» — ТА ЖЕ ДОРОГА, ЧТО ИЗ ЗАПИСИ (владелец
          2026-09-20: «там нет кнопки добавить клиента… должна открываться так
          же, как в записи, и потом оно сразу автоматически выбирается»).
          Карточка нового клиента открывается ПОВЕРХ чека в том же корневом
          стеке, набранное остаётся, а «Готово» отдаёт id сюда — и клиент
          встаёт в чек сам (`pending-client.ts`). */}
      <PickerSheet
        visible={sheet === "company"}
        title="Реквизиты"
        items={[
          ...liveCompanies.map((c) => ({
            id: c.id,
            label: c.name,
            // Та же подпись, что на странице «Реквизиты»: один набор
          // не выглядит в выборе иначе, чем в справочнике.
          hint: companyDetail(c),
            // Вид набора — его собственный: две фирмы в списке различает
            // плитка, а не чтение имени. Нет вида — прежний «дом» акцентом.
            icon: iconPreset(c.icon) ?? Building2,
            color: c.color ?? t.accent,
            onPress: () => onChange({ companyId: c.id }),
          })),
        ]}
        selectedId={company?.id ?? null}
        // «Завести компанию» — дверь в справочник, а не вторая форма: юрлицо
        // заводят один раз и печатают им годами.
        onSettings={onOpenCompany}
        settingsLabel="Реквизиты"
        onClose={() => setSheet(null)}
      />

      <ClientPickerSheet
        visible={sheet === "client"}
        selectedId={draft.clientId}
        onCreate={(prefill) => {
          setSheet(null);
          router.push({ pathname: "/client", params: { id: "new", ...prefill } });
        }}
        onSelect={(picked) => {
          onChange({ clientId: picked.id });
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
      />

      <ServicePicker
        visible={sheet === "services"}
        services={services.data ?? []}
        selectedIds={draft.lines.map((l) => l.serviceId)}
        quantities={Object.fromEntries(draft.lines.map((l) => [l.serviceId, l.quantity]))}
        onToggle={toggleService}
        onQtyChange={changeQty}
        onClose={() => setSheet(null)}
      />

      <TotalSheet
        visible={sheet === "total"}
        onClose={() => setSheet(null)}
        lines={blockLines}
        onQtyChange={changeQty}
        onPriceChange={changePrice}
        discount={{
          kind: draft.discountType,
          value: draft.discountValue,
          onKindChange: (discountType) => onChange({ discountType }),
          onValueChange: (discountValue) => onChange({ discountValue }),
        }}
        total={totals.total}
        vat={{
          mode: draft.vatMode,
          rate: vatRate,
          onModeChange: (vatMode) => onChange({ vatMode }),
          onRateChange: (vatRate) => {
            onChange({ vatRate });
            rememberedRate.remember(vatRate);
          },
        }}
      />

      {/* ДАТА БЕЗ ЧАСОВ (владелец 2026-09-20: «чётко по времени не надо»):
          обычный барабан даты, тот же, что у срока инвойса. Деньги приняты в
          такой-то день — час приёма документу не нужен. */}
      <DateWheelSheet
        visible={sheet === "when"}
        title="Дата чека"
        value={draft.date}
        maximumDate={businessToday}
        onApply={(ymd) => {
          onChange({ date: ymd });
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
      />
    </>
  );
}

/** Новая строка работ — теми же полями, что кладёт запись. */
function newLine(svc: Service): AppointmentService {
  return recalc(
    {
      serviceId: svc.id,
      quantity: 1,
      pricePerUnit: svc.price,
      originalPrice: svc.price,
      totalPrice: svc.price,
      // Длительность строки — базовая длительность услуги: `recalc` умножит
      // её на количество, как в записи.
      duration: svc.duration_minutes,
      serviceName: svc.name,
      unit: svc.unit,
    },
    {},
  );
}

/** Пересчёт строки после правки количества или цены — тем же `lineTotal`,
 *  которым считает запись. Длительность идёт за количеством: одна услуга на
 *  два кондиционера занимает вдвое больше времени. */
function recalc(
  line: AppointmentService,
  patch: Partial<Pick<AppointmentService, "quantity" | "pricePerUnit">>,
): AppointmentService {
  const perOne = line.quantity > 0 ? line.duration / line.quantity : line.duration;
  const next = { ...line, ...patch };
  return {
    ...next,
    totalPrice: lineTotal(next),
    duration: Math.round(perOne * next.quantity),
  };
}
