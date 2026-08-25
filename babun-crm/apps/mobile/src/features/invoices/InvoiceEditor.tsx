import { useEffect, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import type { Appointment } from "@babun/shared/local/appointments";
import type { Client } from "@babun/shared/local/clients";
import type { VatSettings } from "@babun/shared/local/finance/vat";
import {
  calculateInvoiceTotals,
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
import { Field } from "@/components/ui/Field";
import { SectionCard } from "@/components/ui/SectionCard";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { GUTTER } from "@/components/ui/tokens";
import { ValueRow } from "@/components/ui/ValueRow";
import { useThemeColors } from "@/theme/colors";
import type { Team } from "@/features/reference/queries";
import type { Tenant } from "@/features/settings/tenant";
import { buildInvoiceDocument } from "./document";
import { useToast } from "@/components/ui/Toast";
import { getStorage } from "@babun/shared/storage";
import { InvoiceLines } from "./InvoiceLines";
import { InvoicePaper } from "./InvoicePaper";
import { INVOICE_LANGUAGE_LABEL, type InvoiceLanguage } from "./dictionary";
import { EntityPickerSheet } from "./EntityPickerSheet";
import { InvoiceDateRow } from "./InvoiceDateRow";
import type { EditableInvoiceLine } from "./InvoiceLineEditor";
import {
  addDaysYmd,
  formatInvoiceDate,
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

/** Язык прошлого счёта — предложение для следующего, а не настройка. */
const INVOICE_LANGUAGE_KEY = "invoice.language";

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
}

// ОДИН ЯЗЫК НАЛОГА НА ВЕСЬ ПРОДУКТ. В листе операции стоят те же три клавиши
// теми же словами: «VAT» латиницей и «Сверху» — это второй словарь для одного
// и того же решения (владелец 2026-08-09).
const VAT_OPTIONS = [
  { value: "off", label: "Без НДС" },
  { value: "inclusive", label: "НДС включён" },
  { value: "exclusive", label: "Плюс НДС" },
] as const;

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
  nextNumber,
  submitting,
  onSubmit,
  onIssuedOnChange,
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
  /** Номер, который документ получит при выставлении. */
  nextNumber?: string;
  submitting: boolean;
  onSubmit: (value: InvoiceEditorValue) => Promise<void>;
  /** Дата выставления — наружу: предпросмотр номера считается по её ГОДУ,
   *  а серию года знает только сервер. */
  onIssuedOnChange?: (ymd: string) => void;
  /** «В форме есть несохранённое» — наружу, к кнопке «Назад». Экран сам
   *  спрашивает, уходить ли: молча стирать заполненный счёт нельзя. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const t = useThemeColors();
  const router = useRouter();
  const toast = useToast();
  // ДВА РЕЖИМА ОДНОГО ЭКРАНА, А НЕ СПЛИТ. Так устроены все телефонные
  // редакторы инвойсов: правка — это форма, документ — отдельный вид, и
  // выставляют его именно с документа, глядя на то, что уйдёт клиенту.
  const [mode, setMode] = useState<"edit" | "paper">("edit");
  /** ЯЗЫК БУМАГИ. У выставленного счёта — свой, у нового — тот, на котором
   *  выставили прошлый: у компании клиентская база обычно одноязычная, и
   *  спрашивать одно и то же каждый раз незачем. */
  const [language, setLanguage] = useState<InvoiceLanguage>(
    () =>
      (initial?.language === "en" ? "en" : initial ? "ru" : null) ??
      (getStorage().get<InvoiceLanguage>(INVOICE_LANGUAGE_KEY) ?? "ru"),
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
  ) => ({
    id: `invoice-line-${serial.current++}`,
    title,
    description,
    qty,
    unitPrice: price,
    unit,
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
  const generate = (appointmentId: string): GeneratedInvoiceDraft | null => {
    const appointment = appointments.find((item) => item.id === appointmentId);
    return appointment
      ? generateInvoiceFromAppointment(appointment, generator, serviceName)
      : null;
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
  const [clientId, setClientId] = useState<string | null>(
    initial?.client_id ?? seed?.clientId ?? prefill?.clientId ?? null,
  );
  const [appointmentId, setAppointmentId] = useState<string | null>(
    initial?.appointment_id ?? prefill?.appointmentId ?? null,
  );
  const initialTeamId = initial?.brigade_id ?? seed?.teamId ?? prefill?.teamId ?? null;
  const [teamId, setTeamId] = useState<string | null>(initialTeamId);
  // Налог инвойса — из ДЕЙСТВУЮЩЕЙ настройки его команды, а не из догадки:
  // сеется один раз при рождении, выставленный документ хранит свой налог и
  // за настройками не следует.
  const seedVat = useRef(vatForTeam(initialTeamId)).current;
  const [vatMode, setVatMode] = useState<InvoiceVatMode>(
    initial ? invoiceVatMode(initial) : seedVat.mode,
  );
  const [vatPercent, setVatPercent] = useState(
    String(initial?.vat_percent || seedVat.rate || 19),
  );
  // Смена команды пересаживает налоговый дефолт, пока клавиши не трогали
  // руками; после ручного выбора форма человека не переспорит.
  const vatTouched = useRef(!!initial);
  const changeTeam = (id: string | null) => {
    setTeamId(id);
    if (vatTouched.current) return;
    const next = vatForTeam(id);
    setVatMode(next.mode);
    setVatPercent(String(next.rate || 19));
  };
  // Приписка компании подставляется в НОВЫЙ документ; выставленный хранит
  // свою и не переписывается вслед за настройкой.
  const [notes, setNotes] = useState(
    initial?.notes ?? seed?.notes ?? generator.footerNote ?? "",
  );
  const [lines, setLines] = useState<EditableInvoiceLine[]>(() => {
    if (initial) {
      return initial.lines.map((line) =>
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
        ),
      );
    }
    return [
      newLine(
        prefill?.title?.trim() || generator.defaultLineTitle,
        "1",
        prefill?.amount && prefill.amount > 0 ? String(prefill.amount) : "",
      ),
    ];
  });
  const [picker, setPicker] = useState<"client" | "appointment" | "team" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Валюта документа — одна на компанию; форма обязана говорить в ней же,
  // а не в зашитом евро.
  const currency = tenant?.currency || "EUR";

  // Год даты выставления решает серию номера — родитель перезапрашивает
  // предпросмотр, когда дата уезжает в другой год.
  useEffect(() => {
    onIssuedOnChange?.(issuedOn);
  }, [issuedOn, onIssuedOnChange]);

  // ЧЕРНОВИК НЕ ПРОПАДАЕТ МОЛЧА. Форма сравнивает себя с той, какой родилась:
  // перечислять «тронутые» поля по одному — способ однажды забыть новое.
  const shape = JSON.stringify({
    issuedOn,
    dueOn,
    clientId,
    appointmentId,
    teamId,
    vatMode,
    vatPercent,
    notes,
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
  const selectedAppointment = appointments.find((item) => item.id === appointmentId);
  const selectedTeam = teams.find((team) => team.id === teamId);

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
  const rate = vatMode === "off" ? 0 : (parseMoneyAmount(vatPercent) ?? -1);
  // Пустая ставка — это НЕ НОЛЬ, а «не указана». Пока поле пустое, серый
  // плейсхолдер «19» читался как настоящее значение, а сводка внизу уже
  // считала 0% и показывала итог без налога: человек видел 19 в поле и
  // цифру без НДС в итоге. Выставить такой инвойс `submit` не даёт, но
  // сводка обязана говорить то же самое, что и кнопка.
  const rateMissing = vatMode !== "off" && rate < 0;
  const totals = calculateInvoiceTotals(
    parsedLines.filter((line) => line.qty > 0 && line.unit_price >= 0),
    vatMode,
    Math.max(0, rate),
  );

  // Зеркало собирается из ТЕХ ЖЕ данных, что уедут на сервер: показываем не
  // «примерно как будет», а сам документ. В режиме правки это значит — из
  // ФОРМЫ: строки, срок, налог и комментарий берутся из состояния, и только
  // неизменяемое (номер, дата выставления, юридические снимки сторон) — из
  // выставленного документа. Витрина сохранённой версии живёт на /invoices/[id].
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
              lines: parsedLines
                .filter((line) => line.qty > 0 && line.unit_price >= 0)
                .map((line, index) => ({
                  id: `${initial.id}-draft-${index}`,
                  invoice_id: initial.id,
                  position: index + 1,
                  title: line.title,
                  description: line.description ?? null,
                  qty: line.qty,
                  unit: line.unit ?? null,
                  unit_price: line.unit_price,
                  total: Math.round(line.qty * line.unit_price * 100) / 100,
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
          })
        : buildInvoiceDocument({
            language,
            tenant,
            client: selectedClient ?? undefined,
            draft: {
              number: nextNumber ?? "Номер присвоится при выставлении",
              issuedOn,
              dueOn,
              clientId,
              lines: parsedLines.map((line) => ({
                title: line.title,
                qty: line.qty,
                // Зеркало обязано печатать «4 м» ровно так же, как это уедет
                // на сервер: единица едет и в черновик, иначе она появлялась
                // бы только у выставленного документа.
                unit: line.unit ?? null,
                unitPrice: Math.max(0, line.unit_price),
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
    [initial, tenant, selectedClient, nextNumber, issuedOn, dueOn, clientId,
     parsedLines, vatMode, rate, totals, notes, businessToday, currency,
     language],
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

  const selectAppointment = (id: string | null) => {
    setAppointmentId(id);
    if (!id) return;
    const draft = generate(id);
    if (!draft) return;
    setClientId(draft.clientId);
    changeTeam(draft.teamId);
    setIssuedOn(draft.issuedOn);
    setDueOn(draft.dueOn);
    // ЗАПОЛНЕННОЕ РУКАМИ НЕ ЗАТИРАЕМ. Привязать заявку к уже набранному счёту —
    // обычное дело, и подставить услуги поверх чужих строк значило бы стереть
    // работу. Генератор входит только в пустой бланк — а бланк с набранным
    // НАЗВАНИЕМ уже не пустой, даже если цену ещё не проставили.
    const only = lines.length === 1 ? lines[0] : null;
    const blank =
      only != null &&
      (!only.unitPrice || Number(only.unitPrice) === 0) &&
      (!only.title.trim() || only.title.trim() === generator.defaultLineTitle);
    if (!blank) return;
    setLines(
      draft.lines.map((line) =>
        newLine(
          line.title,
          String(line.qty),
          String(line.unitPrice),
          line.description ?? null,
        ),
      ),
    );
    if (draft.notes && !notes.trim()) setNotes(draft.notes);
  };

  const submit = async () => {
    setError(null);
    if (parsedLines.some((line) => !line.title || line.qty <= 0 || line.unit_price < 0)) {
      setError("Проверьте название, количество и цену каждой позиции.");
      return;
    }
    if (totals.total <= 0) {
      setError("Итог инвойса должен быть больше нуля.");
      return;
    }
    if (rate < 0 || rate > 100) {
      setError("Ставка НДС должна быть от 0 до 100% и не больше двух знаков.");
      return;
    }
    try {
      await onSubmit({
        language,
        issued_on: issuedOn,
        due_on: dueOn,
        client_id: clientId,
        appointment_id: appointmentId,
        brigade_id: teamId,
        vat_mode: vatMode,
        vat_percent: rate,
        lines: parsedLines,
        notes: notes.trim() || null,
        link_to_tx_id: initial ? null : prefill?.transactionId ?? null,
      });
    } catch (submissionError) {
      setError((submissionError as Error).message);
    }
  };

  // Кнопка не называет сумму, которой ещё нет: без ставки НДС итог неизвестен.
  const actionVerb = initial ? "Сохранить" : "Выставить инвойс";
  const actionLabel = rateMissing
    ? actionVerb
    : `${actionVerb} · ${formatInvoiceMoney(totals.total, currency)}`;

  // Тумблер «Работаем с НДС» гасит слово «НДС» во всём продукте (канон
  // OperationSheet). Легаси-документ, выставленный с налогом, клавиши
  // сохраняет — иначе его нельзя было бы честно править.
  const vatCollapsed = vatForTeam(teamId).mode === "off" && vatMode === "off";

  if (mode === "paper") {
    return (
      <View className="flex-1">
        <ModeSwitch mode={mode} onChange={setMode} />
        {/* ЯЗЫК ПЕРЕКЛЮЧАЕТСЯ НА САМОМ ДОКУМЕНТЕ (владелец 2026-08-25: «мне
            нужен инвойс на английском»). Не в настройках компании: у одного
            клиента бумага русская, у следующего английская, и решают это,
            глядя на неё, а не вспоминая, где лежит галочка. Выбор запоминается
            и предлагается следующему счёту. */}
        <View
          className="flex-row items-center justify-end gap-2 px-4 pb-1"
        >
          {(["ru", "en"] as const).map((code) => {
            const active = language === code;
            return (
              <Pressable
                key={code}
                onPress={() => {
                  setLanguage(code);
                  getStorage().set(INVOICE_LANGUAGE_KEY, code);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Язык документа: ${INVOICE_LANGUAGE_LABEL[code]}`}
                style={({ pressed }) => ({
                  minHeight: 32,
                  justifyContent: "center",
                  paddingHorizontal: 12,
                  borderRadius: t.radius.card,
                  borderCurve: "continuous",
                  backgroundColor: active ? t.accent : t.fill,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Text
                  maxFontSizeMultiplier={1.2}
                  style={{
                    fontSize: 13,
                    fontWeight: active ? "700" : "500",
                    color: active ? t.onAccent : t.sub,
                  }}
                >
                  {INVOICE_LANGUAGE_LABEL[code]}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 12, paddingBottom: 28 }}
        >
          <InvoicePaper doc={paperDoc} />
        </ScrollView>
        {/* КНОПКА ВЫПУСКА ЖИВЁТ НА ДОКУМЕНТЕ. Человек нажимает её, глядя на то,
            что уйдёт клиенту, а не на форму с полями. */}
        <View
          className="px-4 pb-7 pt-3"
          style={{ backgroundColor: t.surface, borderTopWidth: 1, borderTopColor: t.separator }}
        >
          {error ? (
            <Text
              accessibilityRole="alert"
              className="mb-2 text-center text-sm"
              style={{ color: t.danger }}
            >
              {error}
            </Text>
          ) : null}
          <Button
            label={actionLabel}
            onPress={submit}
            loading={submitting}
            disabled={submitting}
          />
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ModeSwitch mode={mode} onChange={setMode} />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <SectionCard title="Получатель">
          <ValueRow
            label="Клиент"
            value={selectedClient?.full_name || "Не выбран"}
            muted={!selectedClient}
            onPress={() => setPicker("client")}
          />
          <ValueRow
            label="Заявка"
            value={
              selectedAppointment
                ? `${formatInvoiceDate(selectedAppointment.date)} · ${selectedAppointment.time_start}`
                : "Не привязана"
            }
            muted={!selectedAppointment}
            onPress={() => setPicker("appointment")}
          />
          <ValueRow
            label="Команда"
            value={selectedTeam?.name || "Не выбрана"}
            muted={!selectedTeam}
            onPress={() => setPicker("team")}
          />
        </SectionCard>

        <SectionCard title="Даты">
          {initial ? (
            <View className="flex-row items-center justify-between px-4 py-3">
              <Text className="text-base" style={{ color: t.ink }}>Дата выставления</Text>
              <Text className="text-base" style={{ color: t.sub }}>{formatInvoiceDate(issuedOn)}</Text>
            </View>
          ) : (
            <InvoiceDateRow
              label="Дата выставления"
              value={issuedOn}
              onChange={(value) => {
                if (!value) return;
                setIssuedOn(value);
                if (dueOn && dueOn < value) setDueOn(value);
              }}
            />
          )}
          <InvoiceDateRow
            label="Оплатить до"
            value={dueOn}
            optional
            minimum={issuedOn}
            onChange={setDueOn}
          />
        </SectionCard>

        {/* ПОЗИЦИЯ — КАРТОЧКА, А НЕ АНКЕТА (владелец 2026-08-25). Устройство и
            доводы — в шапке `InvoiceLines.tsx`: карточка со степпером, правка
            листом по тапу, новая строка из каталога с поиском, свайп влево
            убирает с «Отменить» в тосте. */}
        <SectionCard title="Позиции" padded>
          <InvoiceLines
            lines={lines}
            currency={currency}
            services={services}
            onChange={setLine}
            onAdd={(service) =>
              setLines((current) => [
                ...current,
                service
                  ? newLine(
                      service.name,
                      "1",
                      String(Number(service.price)),
                      service.description,
                      service.unit,
                    )
                  : newLine(),
              ])
            }
            onRemove={removeLine}
            onReorder={(id, delta) =>
              setLines((current) => {
                const from = current.findIndex((item) => item.id === id);
                const to = from + delta;
                if (from < 0 || to < 0 || to >= current.length) return current;
                const next = [...current];
                [next[from], next[to]] = [next[to], next[from]];
                return next;
              })
            }
          />
        </SectionCard>

        {vatCollapsed ? (
          // Компания не работает с НДС — клавиш налога нет нигде, только
          // строка-дверь к настройке (паттерн настроек счёта).
          <SectionCard title="Налог">
            <ValueRow
              label="НДС"
              value="Компания не работает с НДС"
              onPress={() => router.push("/finances/vat")}
            />
          </SectionCard>
        ) : (
          <SectionCard title="Налог" padded>
            <SegmentedControl
              options={VAT_OPTIONS}
              value={vatMode}
              onChange={(next) => {
                vatTouched.current = true;
                setVatMode(next);
              }}
            />
            {vatMode !== "off" ? (
              <View className="mt-4">
                <Field
                  label="Ставка НДС, %"
                  value={vatPercent}
                  onChangeText={(next) => {
                    vatTouched.current = true;
                    setVatPercent(next);
                  }}
                  keyboardType="decimal-pad"
                  // Плейсхолдер не повторяет значение по умолчанию: серое
                  // «19» невозможно отличить от введённых 19%.
                  placeholder="Не указана"
                  error={rateMissing ? "Укажите ставку — иначе инвойс не выставить" : null}
                />
              </View>
            ) : null}
            <View
              className="px-3 py-2"
              style={{ borderRadius: t.radius.input, backgroundColor: t.fill }}
            >
              <SummaryRow label="Без НДС" value={formatInvoiceMoney(totals.subtotal_net, currency)} />
              {vatMode !== "off" ? (
                <SummaryRow
                  label={rateMissing ? "НДС" : `НДС ${rate}%`}
                  value={rateMissing ? "ставка не указана" : formatInvoiceMoney(totals.vat_amount, currency)}
                />
              ) : null}
              <SummaryRow
                label="Итого"
                value={rateMissing ? "—" : formatInvoiceMoney(totals.total, currency)}
                strong
              />
            </View>
          </SectionCard>
        )}

        <SectionCard title="Комментарий" padded>
          <Field
            label="Примечание для инвойса"
            value={notes}
            onChangeText={setNotes}
            placeholder="Условия оплаты или дополнительная информация"
            multiline
            style={{ minHeight: 88, textAlignVertical: "top" }}
          />
        </SectionCard>

      </ScrollView>

      {/* ИТОГ ЖИВЁТ ВНИЗУ И НЕ УЕЗЖАЕТ С ПРОКРУТКОЙ. Кнопка выпуска стояла
          последней строкой формы: чтобы увидеть, на какую сумму документ,
          приходилось долистать до конца — а сумма меняется от каждого тапа по
          степперу. Здесь она всегда на глазах, и `KeyboardAvoidingView` выше
          поднимает её над клавиатурой. */}
      <View
        className="px-4 pb-7 pt-3"
        style={{
          backgroundColor: t.surface,
          borderTopWidth: 1,
          borderTopColor: t.separator,
        }}
      >
        {error ? (
          <Text
            accessibilityRole="alert"
            className="mb-2 text-center text-sm"
            style={{ color: t.danger }}
          >
            {error}
          </Text>
        ) : null}
        <Button
          label={actionLabel}
          onPress={submit}
          loading={submitting}
          disabled={submitting}
        />
      </View>

      <EntityPickerSheet
        visible={picker === "client"}
        title="Клиент"
        selectedId={clientId}
        options={clients.map((client) => ({ id: client.id, title: client.full_name, subtitle: client.phone }))}
        onPick={setClientId}
        onClose={() => setPicker(null)}
      />
      <EntityPickerSheet
        visible={picker === "appointment"}
        title="Заявка"
        selectedId={appointmentId}
        options={appointments
          .filter((item) => item.kind === "work" && item.status !== "cancelled")
          .map((item) => ({
            id: item.id,
            title: `${formatInvoiceDate(item.date)} · ${item.time_start}`,
            subtitle: `${clientById.get(item.client_id ?? "")?.full_name ?? "Без клиента"} · ${formatInvoiceMoney(item.total_amount, currency)}`,
          }))}
        onPick={selectAppointment}
        onClose={() => setPicker(null)}
      />
      <EntityPickerSheet
        visible={picker === "team"}
        title="Команда"
        selectedId={teamId}
        options={teams.map((team) => ({ id: team.id, title: team.name, subtitle: team.region ?? undefined }))}
        onPick={changeTeam}
        onClose={() => setPicker(null)}
      />
    </KeyboardAvoidingView>
  );
}

function ModeSwitch({
  mode,
  onChange,
}: {
  mode: "edit" | "paper";
  onChange: (next: "edit" | "paper") => void;
}) {
  return (
    <SegmentedControl
      options={[
        { value: "edit", label: "Правка" },
        { value: "paper", label: "Документ" },
      ]}
      value={mode}
      onChange={onChange}
      style={{ marginHorizontal: GUTTER, marginTop: 10, marginBottom: 2 }}
    />
  );
}

function SummaryRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const t = useThemeColors();
  return (
    <View className="flex-row items-center justify-between py-1.5">
      <Text className={strong ? "text-base font-semibold" : "text-sm"} style={{ color: strong ? t.ink : t.sub }}>
        {label}
      </Text>
      <Text
        className={strong ? "text-lg font-bold" : "text-sm font-medium"}
        // Только стилем: `tabular-nums` в className в этом стеке — пустышка.
        style={{ color: t.ink, fontVariant: ["tabular-nums"] }}
      >
        {value}
      </Text>
    </View>
  );
}
