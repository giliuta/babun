import { useEffect, useMemo, useRef, useState } from "react";
import {
  generateInvoiceFromAppointment,
  type GeneratedInvoiceDraft,
} from "@babun/shared/local/finance/invoice-generator";
import type { InvoiceVatMode } from "@babun/shared/local/finance/invoice-ledger";
import { inputFromGross } from "@babun/shared/local/finance/vat";
import { round2 } from "@babun/shared/local/finance/appointment-calc";
import { isUiLocale } from "@babun/shared/i18n/locales";
import type { DiscountKind } from "@/features/appointments/TotalSheet";
import { useRememberedVatRate } from "@/features/finances/remembered-vat-rate";
import type { InvoiceLanguage } from "../dictionary";
import { addDaysYmd, type EditableInvoiceLine } from "../format";
import {
  appointmentVatOf,
  existingDiscountOf,
  incomeAmountOf,
  initialInvoiceVatMode,
} from "./invoice-rules";
import type { InvoiceEditorProps } from "./types";

/** The invoice form's own state: how it is born (from an issued document, a
 *  visit, an income or from scratch) and every field the person changes. */
export function useInvoiceDraft({
  prefill,
  existing,
  vatForTeam,
  appointments,
  services,
  generator,
  teams,
  businessToday,
}: Pick<
  InvoiceEditorProps,
  | "prefill"
  | "existing"
  | "vatForTeam"
  | "appointments"
  | "services"
  | "generator"
  | "teams"
  | "businessToday"
>) {
  /** ЯЗЫК БУМАГИ. У выставленного счёта — свой, у нового — ВСЕГДА английский
   *  (владелец 2026-09-22: инвойсы уходят в министерство, а там принимают
   *  греческий или английский). Не запоминается ни за устройством, ни за
   *  клиентом: другой язык — разовый выбор. Выбирают его строкой «Язык» в
   *  «Реквизитах» и блоком «Язык» в предпросмотре — одно значение, две двери:
   *  в форме язык виден до выпуска, в предпросмотре — вместе с бумагой.
   *  Правка выставленного счёта открывается на его языке — любом из семи. */
  const existingLanguage = existing?.language;
  const [language, setLanguage] = useState<InvoiceLanguage>(
    isUiLocale(existingLanguage) ? existingLanguage : "en",
  );
  const [languageOpen, setLanguageOpen] = useState(false);
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
  // See `appointmentVatOf`: the visit's tax moves into the invoice.
  const appointmentVat = appointmentVatOf(sourceAppointment);
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
  // Invoice from an income must match it to the cent (`incomeAmountOf`).
  const incomeAmount = incomeAmountOf(prefill);
  const seed = useRef(
    prefill?.appointmentId &&
      (incomeAmount == null ||
        (sourceAppointment != null && round2(sourceAppointment.total_amount) === incomeAmount))
      ? generate(prefill.appointmentId)
      : null,
  ).current;

  // Future issue dates remain intentionally available (the server permits
  // scheduled documents), but a new document always starts on tenant today.
  //
  // ДАТА ВЫСТАВЛЕНИЯ — НЕ РАНЬШЕ СЕГОДНЯ (аудит 03.10). Счёт по прошлому визиту
  // (или по деньгам, принятым раньше) датировался днём визита: срок оплаты
  // считался от него, и документ рождался «Просрочен», а номер вставал после
  // уже выданных, но с датой раньше их — серия шла не по датам. Визит в
  // будущем остаётся своей датой; руками дату по-прежнему можно сменить.
  const sourceIssuedOn = seed?.issuedOn ?? prefill?.issuedOn ?? businessToday;
  const firstIssuedOn = sourceIssuedOn > businessToday ? sourceIssuedOn : businessToday;
  const [issuedOn, setIssuedOn] = useState(existing?.issued_on ?? firstIssuedOn);
  const [dueOn, setDueOn] = useState<string | null>(
    // Срок — из настроек компании, а не зашитая неделя (владелец 2026-08-15),
    // и считается от даты выставления, а не от визита.
    existing
      ? existing.due_on
      : addDaysYmd(firstIssuedOn, Math.max(0, generator.dueDays)),
  );
  // Общая на «Правку» (строка-дверь) и «Документ» (барабан бумаги): смена
  // даты выставления подтягивает «Оплатить до», если та уже оказалась раньше.
  const changeIssuedOn = (value: string | null) => {
    if (!value) return;
    setIssuedOn(value);
    if (dueOn && dueOn < value) setDueOn(value);
  };
  const [clientId, setClientId] = useState<string | null>(
    existing ? existing.client_id : seed?.clientId ?? prefill?.clientId ?? null,
  );
  /** ОБЪЕКТ СЧЁТА (владелец 2026-09-22): у счёта из записи — объект записи,
   *  у выставленного — свой; при выборе клиента — его основной объект. */
  const [locationId, setLocationId] = useState<string | null>(
    existing ? existing.location_id ?? null : sourceAppointment?.location_id ?? null,
  );
  /** РЕКВИЗИТЫ КЛИЕНТА (владелец 22.09): на какой набор клиента выписан
   *  счёт; `null` — основной. */
  const [clientRequisitesId, setClientRequisitesId] = useState<string | null>(
    existing?.client_requisites_id ?? null,
  );
  // ЗАЯВКА ПРИЕЗЖАЕТ, НО НЕ МЕНЯЕТСЯ ЗДЕСЬ: счёт по работе открывают ИЗ
  // работы, и форма только несёт её дальше на сервер.
  const appointmentId = existing ? existing.appointment_id : prefill?.appointmentId ?? null;
  // Первая команда — сразу при рождении, а не эффектом после: иначе форма
  // запоминала себя без команды, и пустой счёт при «назад» спрашивал
  // «Черновик не сохранён» (разбор 2026-09-22, баг 6).
  const initialTeamId = existing
    ? existing.brigade_id ?? teams[0]?.id ?? null
    : seed?.teamId ?? prefill?.teamId ?? teams[0]?.id ?? null;
  // КОМАНДА РЕШАЕТ ТРИ ВЕЩИ СРАЗУ: чей прайс предлагать в услугах, чьи кассы
  // показывать и по какому календарю лягут деньги. Поэтому она наверху,
  // лентой, и видна всегда — а не строкой в анкете, куда надо долистать.
  const [teamId, setTeamId] = useState<string | null>(initialTeamId);
  // Налог инвойса — из ДЕЙСТВУЮЩЕЙ настройки его команды, а не из догадки:
  // сеется один раз при рождении, выставленный документ хранит свой налог и
  // за настройками не следует.
  const seedVat = useRef(vatForTeam(initialTeamId)).current;
  // Opening tax mode: see `initialInvoiceVatMode`.
  const [vatMode, setVatMode] = useState<InvoiceVatMode>(() =>
    initialInvoiceVatMode({
      existing,
      incomeAmount,
      hasSourceAppointment: !!sourceAppointment,
      appointmentVat,
      seedVatMode: seedVat.mode,
      seeded: !!seed,
    }),
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
  // Не писали ставку на этом телефоне — ставка команды из настроек.
  const rememberedRate = useRememberedVatRate(vatForTeam(teamId).rate);
  const [rateOverride, setRateOverride] = useState<number | null>(
    existing && existing.vat_percent > 0 ? existing.vat_percent : appointmentVat?.rate ?? null,
  );
  const documentRate = rateOverride ?? rememberedRate.rate;
  // Смена команды пересаживает налоговое умолчание, пока клавиши VAT не
  // трогали руками; после ручного выбора форма человека не переспорит.
  const vatTouched = useRef(!!existing || !!appointmentVat || incomeAmount != null);
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
    existing ? existing.notes ?? "" : seed?.notes ?? generator.footerNote ?? "",
  );
  // The issued invoice's discount line (`existingDiscountOf`).
  const existingDiscount = existingDiscountOf(existing);
  const [lines, setLines] = useState<EditableInvoiceLine[]>(() => {
    if (existing) {
      return existing.lines
        .filter((line) => line.unit_price >= 0)
        .map((line) =>
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
    existingDiscount > 0 ? "fixed" : "percent",
  );
  const [discountValue, setDiscountValue] = useState<string>(
    existingDiscount > 0 ? String(existingDiscount) : "",
  );
  const [error, setError] = useState<string | null>(null);
  /** Какими реквизитами подписан счёт, если их выбрали руками. `null` —
   *  основные (`pickedCompany`): документ не должен требовать выбора там, где
   *  ответ и так известен. На сервер уходят ВСЕГДА те, что в превью. */
  const [companyId, setCompanyId] = useState<string | null>(existing?.company_id ?? null);
  // Счёт в форме не выбирают (владелец 04.10) — только при приёме оплаты.
  // У старого счёта, где он задан, правка его не сбрасывает.
  const accountId = existing?.account_id ?? null;
  /** ПРЕВЬЮ — ОБЯЗАТЕЛЬНЫЙ ШАГ (владелец 2026-09-20: «сначала делается превью
   *  этого инвойса, и потом я нажимаю сохранить»). */
  const [previewOpen, setPreviewOpen] = useState(false);

  return {
    language,
    setLanguage,
    languageOpen,
    setLanguageOpen,
    newLine,
    incomeAmount,
    issuedOn,
    dueOn,
    setDueOn,
    changeIssuedOn,
    clientId,
    setClientId,
    locationId,
    setLocationId,
    clientRequisitesId,
    setClientRequisitesId,
    appointmentId,
    teamId,
    changeTeam,
    vatMode,
    setVatMode,
    rememberedRate,
    rateOverride,
    setRateOverride,
    documentRate,
    vatTouched,
    notes,
    setNotes,
    lines,
    setLines,
    discountKind,
    setDiscountKind,
    discountValue,
    setDiscountValue,
    error,
    setError,
    companyId,
    setCompanyId,
    accountId,
    previewOpen,
    setPreviewOpen,
  };
}
