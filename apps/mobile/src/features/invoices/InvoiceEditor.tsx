import { useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Text, View } from "react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import type { Client } from "@babun/shared/local/clients";
import type { VatSettings } from "@babun/shared/local/finance/vat";
import {
  calculateInvoiceTotals,
  invoiceLineTotal,
  type InvoiceLedgerWithLines,
  type InvoiceLineDraft,
  type InvoiceVatMode,
} from "@babun/shared/local/finance/invoice-ledger";
import {
  generateInvoiceFromAppointment,
  type GeneratedInvoiceDraft,
  type InvoiceGeneratorSettings,
} from "@babun/shared/local/finance/invoice-generator";
import type { Service } from "@/features/services/queries";
import { Button } from "@/components/ui/Button";
import { useThemeColors } from "@/theme/colors";
import type { Team } from "@/features/reference/queries";
import type { Tenant } from "@/features/settings/tenant";
import { buildInvoiceDocument, type InvoiceDraftSeller } from "./document";
import { useCompanies, defaultCompany } from "@/features/companies/queries";
import { useToast } from "@/components/ui/Toast";
import { applyDiscount, round2 } from "@babun/shared/local/finance/appointment-calc";
import { inputFromGross } from "@babun/shared/local/finance/vat";
import type { DiscountKind } from "@/features/appointments/TotalSheet";
import { useRememberedVatRate } from "@/features/finances/remembered-vat-rate";
import { InvoiceBlocks } from "./InvoiceBlocks";
import { useNextInvoiceSeries } from "./queries";
import { InvoicePreviewSheet } from "./InvoicePreviewSheet";
import { ScopeChips } from "@/components/ui/ScopeChips";
import type { InvoiceLanguage } from "./dictionary";
import {
  addDaysYmd,
  type EditableInvoiceLine,
  formatInvoiceMoney,
  invoiceVatMode,
  parseDecimal,
  parseMoneyAmount,
} from "./format";

export interface InvoicePrefill {
  transactionId?: string | null;
  clientId?: string | null;
  appointmentId?: string | null;
  teamId?: string | null;
  amount?: number | null;
  title?: string | null;
  issuedOn?: string | null;
}

export interface InvoiceEditorValue {
  issued_on: string;
  due_on: string | null;
  client_id: string | null;
  appointment_id: string | null;
  brigade_id: string | null;
  vat_mode: InvoiceVatMode;
  vat_percent: number;
  lines: InvoiceLineDraft[];
  /** Язык бумаги — пишется вторым шагом после выставления (см. queries). */
  language?: "ru" | "en";
  notes: string | null;
  link_to_tx_id: string | null;
  /** Набор реквизитов, которым подписан счёт. `null` — сервер подставит
   *  основные (`resolve_company_id`, миграция 20260921000000). */
  company_id: string | null;
  /** Объект клиента, под который выписан счёт (миграция 20260922060000). */
  location_id?: string | null;
  /** Счёт, на который ждём деньги. */
  account_id: string | null;
}

export function InvoiceEditor({
  initial,
  prefill,
  vatForTeam,
  clients,
  appointments,
  services,
  generator,
  teams,
  businessToday,
  tenant,
  submitting,
  onSubmit,
  onDirtyChange,
}: {
  initial?: InvoiceLedgerWithLines;
  prefill?: InvoicePrefill;
  /** Действующий НДС по команде (счёт → команда → компания, счёта у инвойса
   *  нет). Резолвер тот же, что у операций: греческая команда получает свои
   *  24%, а не кипрский дефолт компании. */
  vatForTeam: (teamId: string | null) => VatSettings;
  clients: Client[];
  appointments: Appointment[];
  /** Справочник услуг — из него генератор берёт названия строк. */
  services: Service[];
  /** Правила генератора: срок, строки, приписка (настройки компании). */
  generator: InvoiceGeneratorSettings;
  teams: Team[];
  businessToday: string;
  /** Реквизиты и логотип компании — их печатает документ. */
  tenant?: Tenant;
  submitting: boolean;
  onSubmit: (value: InvoiceEditorValue) => Promise<void>;
  /** «В форме есть несохранённое» — наружу, к кнопке «Назад». Экран сам
   *  спрашивает, уходить ли: молча стирать заполненный счёт нельзя. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const t = useThemeColors();
  const toast = useToast();
  /** ЯЗЫК БУМАГИ. У выставленного счёта — свой, у нового — ВСЕГДА английский
   *  (владелец 2026-09-22: инвойсы уходят в министерство, а там принимают
   *  греческий или английский). Не запоминается ни за устройством, ни за
   *  клиентом: русский — разовый выбор в шторке предпросмотра. */
  const [language, setLanguage] = useState<InvoiceLanguage>(() =>
    initial ? (initial.language === "en" ? "en" : "ru") : "en",
  );
  const serial = useRef(0);
  const newLine = (
    title = "",
    qty = "1",
    price = "",
    description: string | null = null,
    // Единица едет с самой строкой, а не подтягивается из прайса при показе:
    // выставленный документ заморожен, и смена единицы у услуги через месяц
    // не переписывает бумагу, которую клиент уже получил.
    unit: string | null = null,
    serviceId: string | null = null,
  ) => ({
    id: `invoice-line-${serial.current++}`,
    title,
    description,
    qty,
    unitPrice: price,
    unit,
    serviceId,
  });

  // ГЕНЕРАТОР — ОДИН НА ВСЕ ДОРОГИ К СЧЁТУ. И форма, открытая с записи, и
  // выбор заявки в самой форме собирают документ одной и той же функцией:
  // иначе счёт по одной работе выглядел бы по-разному в зависимости от того,
  // откуда его начали.
  // У УСЛУГИ ОДНО ИМЯ (2026-08-20). Второго, «для документов», в справочнике
  // больше нет: его не заполнил никто, а формулировку для клиента правят в
  // самой строке счёта, где она и замерзает вместе с документом. Описание —
  // другое дело: оно отвечает не «как назвать», а «что входит», и едет в
  // документ второй строкой под названием.
  const serviceName = useMemo(() => {
    const byId = new Map(
      services.map((service) => [
        service.id,
        {
          name: service.name,
          description: service.description,
          // Единица едет в документ вместе с именем и описанием: колонка
          // «Кол-во» обязана печатать «4 м», а не голое «4».
          unit: service.unit,
        },
      ]),
    );
    return (id: string) => byId.get(id);
  }, [services]);
  const sourceAppointment = prefill?.appointmentId
    ? appointments.find((item) => item.id === prefill.appointmentId) ?? null
    : null;
  /** НАЛОГ ЗАПИСИ ПЕРЕЕЗЖАЕТ В ИНВОЙС (22.09). «К оплате» записи уже
   *  включает VAT: при «сверху» строки счёта раскладываются на сумму ДО
   *  налога, и инвойс начисляет его сам той же ставкой — иначе налог вошёл бы
   *  в цены и был начислен второй раз. */
  const appointmentVat =
    sourceAppointment &&
    (sourceAppointment.vat_mode === "inclusive" || sourceAppointment.vat_mode === "exclusive") &&
    (sourceAppointment.vat_rate ?? 0) > 0
      ? { mode: sourceAppointment.vat_mode, rate: Number(sourceAppointment.vat_rate) }
      : null;
  const generate = (appointmentId: string): GeneratedInvoiceDraft | null => {
    const appointment = appointments.find((item) => item.id === appointmentId);
    if (!appointment) return null;
    const vat = appointment.id === sourceAppointment?.id ? appointmentVat : null;
    const base =
      vat?.mode === "exclusive"
        ? {
            ...appointment,
            total_amount: inputFromGross(appointment.total_amount, "exclusive", vat.rate),
          }
        : appointment;
    return generateInvoiceFromAppointment(base, generator, serviceName);
  };
  // Черновик по записи, с которой пришли. Считается ОДИН РАЗ при рождении
  // формы: пересчёт на каждый рендер стирал бы то, что человек уже правит.
  const seed = useRef(
    !initial && prefill?.appointmentId ? generate(prefill.appointmentId) : null,
  ).current;

  // Future issue dates remain intentionally available (the server permits
  // scheduled documents), but a new document always starts on tenant today.
  // Счёт по записи датируется днём визита — как и раньше, но теперь эту дату
  // называет генератор, а не параметр в адресе.
  const firstIssuedOn =
    initial?.issued_on ?? seed?.issuedOn ?? prefill?.issuedOn ?? businessToday;
  const [issuedOn, setIssuedOn] = useState(firstIssuedOn);
  const [dueOn, setDueOn] = useState<string | null>(
    // Срок — из настроек компании, а не зашитая неделя (владелец 2026-08-15).
    initial?.due_on ??
      seed?.dueOn ??
      addDaysYmd(firstIssuedOn, Math.max(0, generator.dueDays)),
  );
  // Общая на «Правку» (строка-дверь) и «Документ» (барабан бумаги): смена
  // даты выставления подтягивает «Оплатить до», если та уже оказалась раньше.
  const changeIssuedOn = (value: string | null) => {
    if (!value) return;
    setIssuedOn(value);
    if (dueOn && dueOn < value) setDueOn(value);
  };
  const [clientId, setClientId] = useState<string | null>(
    initial?.client_id ?? seed?.clientId ?? prefill?.clientId ?? null,
  );
  /** ОБЪЕКТ СЧЁТА (владелец 2026-09-22): у счёта из записи — объект записи,
   *  у выставленного — свой; при выборе клиента — его основной объект. */
  const [locationId, setLocationId] = useState<string | null>(
    initial ? initial.location_id ?? null : sourceAppointment?.location_id ?? null,
  );
  // ЗАЯВКА ПРИЕЗЖАЕТ, НО НЕ МЕНЯЕТСЯ ЗДЕСЬ: счёт по работе открывают ИЗ
  // работы, и форма только несёт её дальше на сервер.
  const appointmentId = initial?.appointment_id ?? prefill?.appointmentId ?? null;
  const initialTeamId = initial?.brigade_id ?? seed?.teamId ?? prefill?.teamId ?? null;
  // КОМАНДА РЕШАЕТ ТРИ ВЕЩИ СРАЗУ: чей прайс предлагать в услугах, чьи кассы
  // показывать и по какому календарю лягут деньги. Поэтому она наверху,
  // лентой, и видна всегда — а не строкой в анкете, куда надо долистать.
  const [teamId, setTeamId] = useState<string | null>(initialTeamId);
  // Налог инвойса — из ДЕЙСТВУЮЩЕЙ настройки его команды, а не из догадки:
  // сеется один раз при рождении, выставленный документ хранит свой налог и
  // за настройками не следует.
  const seedVat = useRef(vatForTeam(initialTeamId)).current;
  const [vatMode, setVatMode] = useState<InvoiceVatMode>(
    initial ? invoiceVatMode(initial) : appointmentVat?.mode ?? seedVat.mode,
  );
  // СТАВКА — ИЗ ДЕЙСТВУЮЩЕЙ НАСТРОЙКИ, А НЕ ИЗ ПОЛЯ ФОРМЫ. Поле жило в блоке
  // «Налог»; блока больше нет, и человек выбирает клавишей VAT только РЕЖИМ —
  // «сколько процентов» отвечает настройка (счёт → команда → компания), как и
  // у чека и у операции. Владелец 2026-09-20: настройка отвечает за ставку, а
  // не за «включить». У выставленного счёта ставка своя и заморожена.
  // …НО ЧЕЛОВЕК МОЖЕТ ЕЁ ПОМЕНЯТЬ тапом по ставке в «Итого» (владелец
  // 2026-09-22): ставка документа — его снимок, и сервер берёт присланную.
  // Ставку пишут цифрами в «Итого», и написанная запоминается для следующих
  // документов (`useRememberedVatRate`). У выставленного — своя, из снимка.
  const rememberedRate = useRememberedVatRate();
  const [rateOverride, setRateOverride] = useState<number | null>(
    initial ? Number(initial.vat_percent ?? 0) : appointmentVat?.rate ?? null,
  );
  const documentRate = rateOverride ?? rememberedRate.rate;
  // Смена команды пересаживает налоговое умолчание, пока клавиши VAT не
  // трогали руками; после ручного выбора форма человека не переспорит.
  const vatTouched = useRef(!!initial || !!appointmentVat);
  const changeTeam = (id: string | null) => {
    setTeamId(id);
    if (vatTouched.current) return;
    setVatMode(vatForTeam(id).mode);
  };
  // ПЕРВАЯ КОМАНДА ПОДСТАВЛЯЕТСЯ САМА, когда её не принесли ни запись, ни
  // чип «Финансов»: счёт без команды не знает ни прайса, ни касс, и пустая
  // лента наверху была бы вопросом без причины.
  useEffect(() => {
    if (teamId != null) return;
    const first = teams[0]?.id;
    if (first) changeTeam(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teams, teamId]);
  // Приписка компании подставляется в НОВЫЙ документ; выставленный хранит
  // свою и не переписывается вслед за настройкой.
  const [notes, setNotes] = useState(
    initial?.notes ?? seed?.notes ?? generator.footerNote ?? "",
  );
  const [lines, setLines] = useState<EditableInvoiceLine[]>(() => {
    if (initial) {
      return initial.lines.filter((line) => line.unit_price >= 0).map((line) =>
        newLine(
          line.title,
          String(line.qty),
          String(line.unit_price),
          line.description,
          line.unit,
        ),
      );
    }
    // Счёт по записи расписан её услугами; счёт «с нуля» и счёт по операции —
    // одна строка с тем, что о ней известно.
    if (seed) {
      return seed.lines.map((line) =>
        newLine(
          line.title,
          String(line.qty),
          String(line.unitPrice),
          line.description ?? null,
          line.unit ?? null,
          line.serviceId ?? null,
        ),
      );
    }
    // СЧЁТ «С НУЛЯ» НАЧИНАЕТСЯ ПУСТЫМ (владелец 2026-09-22). Раньше здесь
    // стояла строка-пустышка «Услуги ×1 €0», которую сначала надо было
    // удалить или переименовать. Строку заводит только то, о чём уже
    // известно, — операция с суммой; иначе блок услуг зовёт «Выбрать услугу».
    if (prefill?.amount && prefill.amount > 0) {
      return [
        newLine(
          prefill.title?.trim() || generator.defaultLineTitle,
          "1",
          String(prefill.amount),
        ),
      ];
    }
    return [];
  });
  // СКИДКА — КАК В ЗАПИСИ (владелец 2026-09-22: «в „Итого“ нет скидки —
  // в записи клиента она есть… можно выдавать скидку»). Та же пара «евро или
  // процент + число», та же шторка «Итого». На сервер уходит одной строкой
  // счёта с флагом `discount` и отрицательной ценой; налог — после скидки.
  // У выставленного счёта скидка уже напечатана строкой — её и поднимаем.
  const [discountKind, setDiscountKind] = useState<DiscountKind>(
    initial?.lines.some((line) => line.unit_price < 0) ? "fixed" : "percent",
  );
  const [discountValue, setDiscountValue] = useState<string>(() => {
    const stored = initial?.lines.find((line) => line.unit_price < 0);
    return stored ? String(-stored.unit_price) : "";
  });
  const [error, setError] = useState<string | null>(null);
  /** Какими реквизитами подписан счёт. `null` — сервер возьмёт основные:
   *  документ не должен требовать выбора там, где ответ и так известен. */
  const [companyId, setCompanyId] = useState<string | null>(initial?.company_id ?? null);
  /** Куда клиент должен заплатить (владелец 2026-09-20). Подсказка платежу, а
   *  не сам платёж: деньги придут отдельной операцией. */
  const [accountId, setAccountId] = useState<string | null>(initial?.account_id ?? null);
  /** ПРЕВЬЮ — ОБЯЗАТЕЛЬНЫЙ ШАГ (владелец 2026-09-20: «сначала делается превью
   *  этого инвойса, и потом я нажимаю сохранить»). */
  const [previewOpen, setPreviewOpen] = useState(false);
  // ЧЕМ ДОКУМЕНТ ПОДПИШЕТСЯ — ТО И ПЕЧАТАЕТ ЗЕРКАЛО. Набор реквизитов знает
  // только справочник, а бумага собирается здесь; без этого превью печатало
  // реквизиты арендатора, а сервер подписывал выбранным набором — человек
  // подтверждал кнопкой одну бумагу, клиент получал другую (аудит бумаги
  // 2026-09-21).
  const companies = useCompanies();

  // Валюта документа — одна на компанию; форма обязана говорить в ней же,
  // а не в зашитом евро.
  const currency = tenant?.currency || "EUR";


  // ЧЕРНОВИК НЕ ПРОПАДАЕТ МОЛЧА. Форма сравнивает себя с той, какой родилась:
  // перечислять «тронутые» поля по одному — способ однажды забыть новое.
  const shape = JSON.stringify({
    issuedOn,
    dueOn,
    clientId,
    locationId,
    appointmentId,
    teamId,
    vatMode,
    rateOverride,
    companyId,
    accountId,
    notes,
    discountKind,
    discountValue,
    lines: lines.map((line) => [line.title, line.description, line.qty, line.unitPrice, line.unit]),
  });
  const bornAs = useRef(shape);
  const dirty = shape !== bornAs.current;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const clientById = useMemo(
    () => new Map(clients.map((client) => [client.id, client])),
    [clients],
  );
  const selectedClient = clientId ? clientById.get(clientId) : null;
  const selectedLocation =
    selectedClient?.locations.find((loc) => loc.id === locationId) ?? null;
  // Новый клиент — его основной объект (как в записи: `isPrimary` — «первый
  // объект для автовыбора»); объект прежнего клиента новому не принадлежит.
  const changeClient = (id: string | null) => {
    setClientId(id);
    const next = id ? clientById.get(id) : null;
    const primary = next?.locations.find((loc) => loc.isPrimary) ?? next?.locations[0];
    setLocationId(primary?.id ?? null);
  };

  const parsedLines = useMemo<InvoiceLineDraft[]>(
    () =>
      lines.map((line) => ({
        title: line.title.trim(),
        description: line.description?.trim() || null,
        qty: parseDecimal(line.qty) ?? 0,
        unit: line.unit ?? null,
        unit_price: parseMoneyAmount(line.unitPrice) ?? -1,
      })),
    [lines],
  );
  const rate = vatMode === "off" ? 0 : documentRate;
  const validLines = parsedLines.filter((line) => line.qty > 0 && line.unit_price >= 0);
  const linesSum = calculateInvoiceTotals(validLines, "off", 0).total;
  const discountNumber = Number(discountValue.replace(",", "."));
  const discountAmount =
    Number.isFinite(discountNumber) && discountNumber > 0
      ? round2(linesSum - applyDiscount(linesSum, { type: discountKind, value: discountNumber }))
      : 0;
  /** Строка скидки для сервера и бумаги — на языке бумаги. */
  const discountLine: InvoiceLineDraft | null =
    discountAmount > 0
      ? {
          title: language === "en" ? "Discount" : "Скидка",
          qty: 1,
          unit_price: -discountAmount,
          discount: true,
        }
      : null;
  const withDiscount = (list: InvoiceLineDraft[]) =>
    discountLine ? [...list, discountLine] : list;
  const totals = calculateInvoiceTotals(
    withDiscount(validLines),
    vatMode,
    Math.max(0, rate),
  );

  // Зеркало собирается из ТЕХ ЖЕ данных, что уедут на сервер: показываем не
  // «примерно как будет», а сам документ. В режиме правки это значит — из
  // ФОРМЫ: строки, срок, налог и комментарий берутся из состояния, и только
  // неизменяемое (номер, дата выставления, юридические снимки сторон) — из
  // выставленного документа. Витрина сохранённой версии живёт на /invoices/[id].
  const pickedCompany = useMemo(() => {
    const rows = companies.data ?? [];
    return (
      rows.filter((row) => !row.archived_at).find((row) => row.id === companyId)
      ?? defaultCompany(rows)
    );
  }, [companies.data, companyId]);
  // НОМЕР — ИЗ СЕРИИ ЭТИХ РЕКВИЗИТОВ И ГОДА ДАТЫ ВЫСТАВЛЕНИЯ (миграция
  // 20260922050000): сменил набор или год — сервер считает заново.
  const issuedYear = Number(issuedOn.slice(0, 4));
  const series = useNextInvoiceSeries(issuedYear, pickedCompany?.id ?? companyId);
  const nextNumber = series.data?.number ?? undefined;
  const paperSeller: InvoiceDraftSeller | null = useMemo(() => {
    const picked = pickedCompany;
    if (!picked) return null;
    return {
      name: picked.name,
      legal_name: picked.legal_name,
      business_address: picked.business_address,
      vat_number: picked.vat_number,
      reg_number: picked.reg_number,
      iban: picked.iban,
      bank_name: picked.bank_name,
      contact_email: picked.contact_email,
      contact_phone: picked.contact_phone,
      logo_url: picked.logo_url,
    };
  }, [pickedCompany]);

  const paperDoc = useMemo(
    () =>
      initial
        ? buildInvoiceDocument({
            language,
            invoice: {
              ...initial,
              due_on: dueOn,
              notes: notes.trim() || null,
              vat_percent: Math.max(0, rate),
              subtotal_net: totals.subtotal_net,
              vat_amount: totals.vat_amount,
              total: totals.total,
              lines: withDiscount(validLines)
                .map((line, index) => ({
                  id: `${initial.id}-draft-${index}`,
                  invoice_id: initial.id,
                  position: index + 1,
                  title: line.title,
                  description: line.description ?? null,
                  qty: line.qty,
                  unit: line.unit ?? null,
                  unit_price: line.unit_price,
                  // Через invoiceLineTotal, а не своим умножением: бумага
                  // выставленного счёта печатает этот total как есть, а строку
                  // итогов считает calculateInvoiceTotals. Своя формула давала
                  // на 1,5 × €2,01 позицию 3,01 против подытога 3,02 — два
                  // разных числа за одну позицию на одном листе.
                  total: invoiceLineTotal(line.qty, line.unit_price),
                })),
            },
            tenant,
            client: selectedClient ?? undefined,
            settlement: {
              income: 0,
              refunded: 0,
              paid: 0,
              remaining: totals.total,
              overpaid: 0,
              isPartial: false,
              isPaid: false,
            },
            payments: [],
            businessToday,
            sellerPreview: paperSeller,
          })
        : buildInvoiceDocument({
            language,
            tenant,
            client: selectedClient ?? undefined,
            location: selectedLocation,
            company: paperSeller,
            draft: {
              number: nextNumber ?? "",
              issuedOn,
              dueOn,
              clientId,
              lines: withDiscount(parsedLines).map((line) => ({
                title: line.title,
                qty: line.qty,
                // Зеркало обязано печатать «4 м» ровно так же, как это уедет
                // на сервер: единица едет и в черновик, иначе она появлялась
                // бы только у выставленного документа.
                unit: line.unit ?? null,
                // Скидку бумага печатает минусом; у прочих строк «−1» —
                // это «цена ещё не набрана», и печатается ноль.
                unitPrice: line.discount ? line.unit_price : Math.max(0, line.unit_price),
              })),
              vatMode,
              vatPercent: Math.max(0, rate),
              subtotalNet: totals.subtotal_net,
              vatAmount: totals.vat_amount,
              total: totals.total,
              currency,
              notes,
            },
          }),
    // Пересобираем на каждое изменение формы — в этом весь смысл зеркала.
    [initial, tenant, selectedClient, selectedLocation, paperSeller, nextNumber, issuedOn, dueOn,
     clientId, parsedLines, vatMode, rate, totals, notes, businessToday,
     currency, language],
  );

  /** УБРАННУЮ ПОЗИЦИЮ ВОЗВРАЩАЮТ ОДНИМ ТАПОМ. Свайп по строке — движение
   *  быстрое, и промах пальца не должен стоить строки счёта: снимок списка
   *  уходит в тост, «Отменить» его возвращает. Восстанавливается ВЕСЬ список,
   *  а не одна строка: порядок позиций в документе — тоже данные. */
  const removeLine = (line: EditableInvoiceLine) => {
    const before = lines;
    setLines((current) => current.filter((item) => item.id !== line.id));
    toast(`«${line.title.trim() || "Позиция"}» убрана`, "info", {
      label: "Вернуть",
      onPress: () => setLines(before),
    });
  };

  const setLine = (next: EditableInvoiceLine) =>
    setLines((current) => current.map((line) => (line.id === next.id ? next : line)));


  const noPrice = parsedLines.every((line) => line.unit_price < 0);
  const noTitle = parsedLines.every((line) => !line.title);
  const reason: { text: string; error: boolean } | null =
    noPrice && noTitle && totals.total <= 0
      ? { text: "Заполните услугу: что и за сколько", error: false }
      : noPrice && totals.total <= 0
        ? { text: "Укажите цену услуги", error: false }
      : parsedLines.some(
            (line) => !line.title || line.qty <= 0 || line.unit_price < 0,
          )
        ? {
            text: "Проверьте название, количество и цену каждой услуги",
            error: true,
          }
        : // СТАВКУ БОЛЬШЕ НЕ ВВОДЯТ РУКАМИ, НО СЕРВЕР ЕЁ ВСЁ РАВНО ПРОВЕРЯЕТ:
          // настройка команды могла прийти испорченной, и молча выставить по
          // ней документ нельзя.
          rate < 0 || rate > 100
          ? {
              text: "Ставка VAT должна быть от 0 до 100% — поправьте её в настройках",
              error: true,
            }
          : totals.total <= 0
            ? { text: "Итог инвойса должен быть больше нуля", error: true }
            : null;

  const submit = async () => {
    setError(null);
    // Кнопка погашена ровно по этой причине; guard остаётся на случай вызова
    // не с кнопки (ротор VoiceOver, будущий «повторить»).
    if (reason) {
      setError(reason.text);
      return;
    }
    try {
      await onSubmit({
        language,
        company_id: companyId,
        account_id: accountId,
        issued_on: issuedOn,
        due_on: dueOn,
        client_id: clientId,
        location_id: locationId,
        appointment_id: appointmentId,
        brigade_id: teamId,
        vat_mode: vatMode,
        vat_percent: rate,
        lines: withDiscount(parsedLines),
        notes: notes.trim() || null,
        link_to_tx_id: initial ? null : prefill?.transactionId ?? null,
      });
    } catch (submissionError) {
      setError((submissionError as Error).message);
    }
  };

  const actionVerb = initial ? "Сохранить" : "Выставить инвойс";
  // Кнопка называет сумму: она и есть ответ на вопрос «на сколько документ».
  const actionLabel = `${actionVerb} · ${formatInvoiceMoney(totals.total, currency)}`;


  return (
    <>
      {/* ЛЕНТА КОМАНД СТОИТ ТАМ ЖЕ, ГДЕ ВЕЗДЕ В ПРОДУКТЕ: первой строкой под
          шапкой экрана, над всем остальным, и в ОБОИХ режимах — владелец
          2026-09-21: «выбор команды оставь на том же месте, где всегда…
          всегда он был зафиксирован в одном». Тот же `ScopeChips`, что в
          календаре и финансах: одна лента на продукт, выбрана ровно одна
          команда, размер и вид не свои.

          Команда решает три вещи сразу: чей прайс предлагать в услугах, чьи
          кассы показывать и по какому календарю лягут деньги. */}
      {/* ЛЕНТА КОМАНД — ВСЕГДА, даже когда команда одна (владелец
          2026-09-22: «сверху обязательно плашка с командой»): инвойс
          выставляется НА КОМАНДУ, и её видно до первого тапа. */}
      {teams.length > 0 ? (
        <ScopeChips
          items={teams.map((team) => ({
            id: team.id,
            name: team.name,
            color: team.color,
          }))}
          activeId={teamId}
          onSelect={changeTeam}
        />
      ) : null}
        <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
          {/* ФОРМА СЧЁТА — БЛОКАМИ, КАК ЗАПИСЬ И ЧЕК. Сами блоки живут в
              `InvoiceBlocks.tsx`: реквизиты, даты, клиент, услуги с «Итого»,
              счёт и комментарий. Здесь остаётся только состояние документа и
              его действие — иначе этот файл рос бы дальше предела. */}
          <InvoiceBlocks
            clients={clients}
            clientId={clientId}
            onClientChange={changeClient}
            locationId={locationId}
            onLocationChange={initial ? undefined : setLocationId}
            issuedOn={issuedOn}
            dueOn={dueOn}
            issuedOnLocked={!!initial}
            onIssuedOnChange={changeIssuedOn}
            onDueOnChange={setDueOn}
            companyId={companyId}
            onCompanyChange={setCompanyId}
            // Номер правят только у нового счёта: у выставленного он свой.
            number={
              initial || !pickedCompany
                ? undefined
                : { companyId: pickedCompany.id, year: issuedYear, next: series.data ?? null }
            }
            teamId={teamId}
            accountId={accountId}
            onAccountChange={setAccountId}
            lines={lines}
            currency={currency}
            services={services}
            onLineChange={setLine}
            onAddLine={(service) =>
              setLines((current) => [
                ...current,
                service
                  ? newLine(
                      service.name,
                      "1",
                      String(Number(service.price)),
                      service.description,
                      service.unit,
                      service.id,
                    )
                  : newLine(),
              ])
            }
            onRemoveLine={removeLine}
            vatMode={vatMode}
            vatRate={Math.max(0, rate)}
            onVatModeChange={(next) => {
              vatTouched.current = true;
              setVatMode(next);
            }}
            discount={{
              kind: discountKind,
              value: discountValue,
              amount: discountAmount,
              onKindChange: setDiscountKind,
              onValueChange: setDiscountValue,
            }}
            onVatRateChange={(next) => {
              vatTouched.current = true;
              setRateOverride(next);
              rememberedRate.remember(next);
            }}
            totals={{ total: totals.total }}
            notes={notes}
            onNotesChange={setNotes}
            footer={
              /* ИТОГ ЖИВЁТ ВНИЗУ И НЕ УЕЗЖАЕТ С ПРОКРУТКОЙ. Кнопка выпуска
                 стояла последней строкой формы: чтобы увидеть, на какую сумму
                 документ, приходилось долистать до конца — а сумма меняется от
                 каждого тапа по степперу. */
              <View
                className="px-4 pb-7 pt-3"
                style={{
                  backgroundColor: t.surface,
                  borderTopWidth: 1,
                  borderTopColor: t.separator,
                }}
              >
                {error ?? reason ? (
                  <Text
                    accessibilityRole={error ? "alert" : undefined}
                    accessibilityLiveRegion="polite"
                    className="mb-2 text-center text-sm"
                    style={{ color: error || reason?.error ? t.danger : t.sub }}
                  >
                    {error ?? reason?.text}
                  </Text>
                ) : null}
                {/* КНОПКА ОТКРЫВАЕТ ПРЕВЬЮ, А НЕ ВЫСТАВЛЯЕТ СРАЗУ. Владелец
                    2026-09-20: «сначала делается превью этого инвойса, и потом
                    я нажимаю сохранить». */}
                <Button
                  label={actionLabel}
                  onPress={() => setPreviewOpen(true)}
                  loading={submitting}
                  disabled={submitting || reason !== null}
                />
              </View>
            }
          />
        </KeyboardAvoidingView>

      <InvoicePreviewSheet
        visible={previewOpen}
        doc={paperDoc}
        busy={submitting}
        label={actionVerb}
        // Документ открывают и посмотреть: пока он не готов, кнопка выпуска
        // в листе погашена и говорит почему — выставить €0 мимо формы нельзя.
        blockedReason={reason?.text ?? null}
        // ЯЗЫК БУМАГИ ВЫБИРАЮТ ТАМ, ГДЕ БУМАГУ ВИДНО: в листе документа перед
        // выпуском (владелец 22.09 убрал миниатюру с формы).
        language={language}
        onChangeLanguage={setLanguage}
        onIssue={() => {
          void submit();
        }}
        onClose={() => setPreviewOpen(false)}
      />


      {/* ЛИСТОВ ВЫБОРА ЗАЯВКИ И КОМАНДЫ ЗДЕСЬ БОЛЬШЕ НЕТ. Клиента выбирают в его блоке — тем
          же `ClientPickerSheet`, что в записи и чеке (и с «Создать клиента»
          внутри, чего у прежнего листа не было).

          ЗАЯВКУ И КОМАНДУ ФОРМА НЕ СПРАШИВАЕТ ВОВСЕ, и это решение, а не
          потеря. Счёт по конкретной работе выставляют ИЗ САМОЙ РАБОТЫ —
          оттуда заявка, клиент, команда и строки приезжают готовыми
          (`prefill` + `generateInvoiceFromAppointment`). Выбор заявки внутри
          формы был вторым путём к тому же и отвечал на вопрос, которого у
          человека, открывшего «Выставить инвойс» из «Финансов», нет: он
          выставляет счёт клиенту, а не подшивает его к заявке. */}
    </>
  );
}
