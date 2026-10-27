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
import type { InvoiceLanguage } from "@/lib/paper/dictionary";
import { addDaysYmd, type EditableInvoiceLine } from "@/lib/paper/format";
import { paperLineTitle } from "../generator-settings";
import {
  appointmentVatOf,
  existingDiscountOf,
  incomeAmountOf,
  initialInvoiceVatMode,
  rolledIssueDates,
} from "./invoice-rules";
import type { StoredInvoiceDraft } from "./stored-draft";
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
   *  (инвойсы уходят в министерство, а там принимают
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
  // У УСЛУГИ ОДНО ИМЯ. Второго, «для документов», в справочнике
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
    return generateInvoiceFromAppointment(
      base,
      { ...generator, defaultLineTitle: paperLineTitle(generator.defaultLineTitle, language) },
      serviceName,
    );
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

  // ДАТА ВЫСТАВЛЕНИЯ НОВОГО ДОКУМЕНТА — СЕГОДНЯ БИЗНЕСА, а не день визита или
  // прихода денег: прошлый день давал счёт «Просрочен» с номером не по датам,
  // будущий сервер отвергает. Руками дату можно сдвинуть назад, но не вперёд
  // (барабан «Выставлен» кончается сегодня).
  //
  // ДАТА, КОТОРУЮ НЕ ТРОГАЛИ, ЕДЕТ ЗА ЧАСАМИ БИЗНЕСА (`rolledIssueDates`): форма,
  // открытая до полуночи, выставляет документ уже новым днём и годом.
  const [issuedOn, setIssuedOn] = useState(existing?.issued_on ?? businessToday);
  const [dueOn, setDueOnState] = useState<string | null>(
    // Срок — из настроек компании, а не зашитая неделя,
    // и считается от даты выставления, а не от визита.
    existing
      ? existing.due_on
      : addDaysYmd(businessToday, Math.max(0, generator.dueDays)),
  );
  const issuedTouched = useRef(!!existing);
  const dueTouched = useRef(!!existing);
  const setDueOn = (value: string | null) => {
    dueTouched.current = true;
    setDueOnState(value);
  };
  // Общая на «Правку» (строка-дверь) и «Документ» (барабан бумаги): смена
  // даты выставления подтягивает «Оплатить до», если та уже оказалась раньше.
  const changeIssuedOn = (value: string | null) => {
    if (!value) return;
    issuedTouched.current = true;
    setIssuedOn(value);
    if (dueOn && dueOn < value) setDueOnState(value);
  };
  /** Даты документа на момент `today` — для превью и для самого выставления. */
  const datesAt = (today: string) =>
    rolledIssueDates({
      issuedOn,
      dueOn,
      issuedTouched: issuedTouched.current,
      dueTouched: dueTouched.current,
      today,
    });
  // Часы бизнеса перевалили за полночь, пока форма открыта: превью и номер
  // серии следуют за новым днём, если даты не трогали.
  useEffect(() => {
    const rolled = datesAt(businessToday);
    if (rolled.issuedOn === issuedOn) return;
    setIssuedOn(rolled.issuedOn);
    setDueOnState(rolled.dueOn);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только смена дня бизнеса; даты и datesAt — из этого же рендера
  }, [businessToday]);
  const [clientId, setClientId] = useState<string | null>(
    existing ? existing.client_id : seed?.clientId ?? prefill?.clientId ?? null,
  );
  /** ОБЪЕКТ СЧЁТА: у счёта из записи — объект записи,
   *  у выставленного — свой; при выборе клиента — его основной объект. */
  const [locationId, setLocationId] = useState<string | null>(
    existing ? existing.location_id ?? null : sourceAppointment?.location_id ?? null,
  );
  /** РЕКВИЗИТЫ КЛИЕНТА: на какой набор клиента выписан
   *  счёт; `null` — основной. */
  const [clientRequisitesId, setClientRequisitesId] = useState<string | null>(
    existing?.client_requisites_id ?? null,
  );
  // ЗАЯВКА ПРИЕЗЖАЕТ, НО НЕ МЕНЯЕТСЯ ЗДЕСЬ: счёт по работе открывают ИЗ
  // работы, и форма только несёт её дальше на сервер.
  const appointmentId = existing ? existing.appointment_id : prefill?.appointmentId ?? null;
  // Первая команда — сразу при рождении, а не эффектом после: иначе форма
  // запоминала себя без команды, и пустой счёт при «назад» спрашивал
  // «Черновик не сохранён».
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
  // у чека и у операции. Настройка отвечает за ставку, а
  // не за «включить». У выставленного счёта ставка своя и заморожена.
  // …НО ЧЕЛОВЕК МОЖЕТ ЕЁ ПОМЕНЯТЬ тапом по ставке в «Итого»: ставка документа —
  // его снимок, и сервер берёт присланную.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- changeTeam пересоздаётся каждый рендер; ждём только команды
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
    // СЧЁТ «С НУЛЯ» НАЧИНАЕТСЯ ПУСТЫМ: строка-пустышка «Услуги ×1 €0» только
    // мешала бы — её пришлось бы удалять или переименовывать. Строку заводит только то, о чём уже
    // известно, — операция с суммой; иначе блок услуг зовёт «Выбрать услугу».
    if (prefill?.amount && prefill.amount > 0) {
      return [
        newLine(
          prefill.title?.trim() || paperLineTitle(generator.defaultLineTitle, language),
          "1",
          String(prefill.amount),
        ),
      ];
    }
    return [];
  });
  // СКИДКА — КАК В ЗАПИСИ: её можно выдать и в «Итого» инвойса. Та же пара «евро или
  // процент + число», та же шторка «Итого». На сервер уходит одной строкой
  // счёта с флагом `discount` и отрицательной ценой; налог — после скидки.
  // У выставленного счёта скидка уже напечатана строкой — её и поднимаем.
  const [discountKind, setDiscountKind] = useState<DiscountKind>(
    existingDiscount > 0 ? "fixed" : "percent",
  );
  const [discountValue, setDiscountValue] = useState<string>(
    existingDiscount > 0 ? String(existingDiscount) : "",
  );
  // СМЕНА ЯЗЫКА БУМАГИ ПЕРЕВОДИТ И СТРОКУ ПО УМОЛЧАНИЮ. Строка «Services»
  // рождается вместе с формой, когда язык ещё английский; выбрали греческий —
  // она становится «Υπηρεσίες». Строку, которую человек переписал, не трогаем.
  const changeLanguage = (next: InvoiceLanguage) => {
    const was = paperLineTitle(generator.defaultLineTitle, language);
    const now = paperLineTitle(generator.defaultLineTitle, next);
    if (was !== now) {
      setLines((current) =>
        current.map((line) => (line.title === was ? { ...line, title: now } : line)),
      );
    }
    setLanguage(next);
  };
  const [error, setError] = useState<string | null>(null);
  /** Какими реквизитами подписан счёт, если их выбрали руками. `null` —
   *  основные (`pickedCompany`): документ не должен требовать выбора там, где
   *  ответ и так известен. На сервер уходят ВСЕГДА те, что в превью. */
  const [companyId, setCompanyId] = useState<string | null>(existing?.company_id ?? null);
  // Счёт в форме не выбирают — только при приёме оплаты.
  // У старого счёта, где он задан, правка его не сбрасывает.
  const accountId = existing?.account_id ?? null;
  /** ПРЕВЬЮ — ОБЯЗАТЕЛЬНЫЙ ШАГ: сначала превью инвойса, потом «Сохранить». */
  const [previewOpen, setPreviewOpen] = useState(false);

  /** Набранное — снимком для черновика, переживающего выгрузку (`stored-draft.ts`). */
  const snapshot: StoredInvoiceDraft = {
    language,
    clientId,
    locationId,
    clientRequisitesId,
    teamId,
    vatMode,
    vatTouched: vatTouched.current,
    rateOverride,
    notes,
    lines: lines.map(({ id: _id, ...line }) => line),
    discountKind,
    discountValue,
    companyId,
  };
  /** Поднять снимок в нетронутую форму. Строки получают новые `id`: счётчик
   *  формы начат заново, и старые совпали бы с теми, что она заведёт. */
  const restore = (stored: StoredInvoiceDraft) => {
    setLanguage(stored.language);
    setClientId(stored.clientId);
    setLocationId(stored.locationId);
    setClientRequisitesId(stored.clientRequisitesId);
    // Команды могло не стать, пока приложение спало, — тогда остаётся своя.
    if (stored.teamId && teams.some((team) => team.id === stored.teamId)) setTeamId(stored.teamId);
    setVatMode(stored.vatMode);
    vatTouched.current = stored.vatTouched;
    setRateOverride(stored.rateOverride);
    setNotes(stored.notes);
    setLines(
      stored.lines.map((line) =>
        newLine(
          line.title,
          line.qty,
          line.unitPrice,
          line.description ?? null,
          line.unit ?? null,
          line.serviceId ?? null,
        ),
      ),
    );
    setDiscountKind(stored.discountKind);
    setDiscountValue(stored.discountValue);
    setCompanyId(stored.companyId);
  };

  return {
    language,
    setLanguage: changeLanguage,
    languageOpen,
    setLanguageOpen,
    newLine,
    incomeAmount,
    issuedOn,
    dueOn,
    setDueOn,
    changeIssuedOn,
    datesAt,
    issuedTouched,
    dueTouched,
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
    snapshot,
    restore,
  };
}
