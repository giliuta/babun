import type { Appointment } from "../appointments";
import { lineTotal, subtotal } from "./appointment-calc";
import { invoiceLineTotal } from "./invoice-ledger";

// ГЕНЕРАТОР ИНВОЙСА ИЗ ЗАПИСИ.
//
// Владелец 2026-08-15: «полноценный генератор инвойса, который прислоняется к
// самой записи клиента». До этого счёт по визиту всегда рождался одной строкой
// «Услуги» на всю сумму: клиент видел цифру и не видел, за что.
//
// Здесь ТОЛЬКО правило сборки — ни сети, ни экрана. Поэтому оно одинаково у
// формы нового счёта, у кнопки в записи и у любого будущего вызова, и покрыто
// тестом отдельно от вёрстки.
//
// ЧТО НЕ ДЕЛАЕТ ЭТА ФУНКЦИЯ: не считает налог (его накидывает
// `calculateInvoiceTotals` по режиму документа) и не назначает номер (его
// выдаёт сервер в момент выставления). Она отвечает на один вопрос — какие
// строки и какой срок получит НОВЫЙ документ по этой работе.

/** Настройки генератора — дефолты компании (`tenants.invoice_*`). */
export interface InvoiceGeneratorSettings {
  /** Через сколько дней платить. 0 — по факту: срок равен дню выставления. */
  dueDays: number;
  /** «services» — каждая услуга своей строкой; «total» — одна на весь визит. */
  lineSource: "services" | "total";
  /** Название строки, когда услуг нет или выбран режим «одной строкой». */
  defaultLineTitle: string;
  /** Приписка внизу счёта. */
  footerNote: string | null;
}

export const INVOICE_GENERATOR_DEFAULTS: InvoiceGeneratorSettings = {
  dueDays: 7,
  lineSource: "services",
  defaultLineTitle: "Услуги",
  footerNote: null,
};

/** Строка будущего счёта. Цены — брутто-нетто-агностичны: налог накидывает
 *  документ по своему режиму, а не эта функция. */
export interface GeneratedInvoiceLine {
  title: string;
  qty: number;
  unitPrice: number;
  /** Описание услуги — печатается второй строкой под названием позиции. */
  description?: string | null;
  /** Единица количества: «4 м» в колонке «Кол-во». Едет из услуги и с этого
   *  момента принадлежит документу. */
  unit?: string | null;
}

export interface GeneratedInvoiceDraft {
  lines: GeneratedInvoiceLine[];
  /** YYYY-MM-DD. */
  issuedOn: string;
  /** YYYY-MM-DD. */
  dueOn: string;
  notes: string | null;
  clientId: string | null;
  teamId: string | null;
}

/** Услуга по её id — справочник тенанта. Неизвестная услуга не выдумывается:
 *  строка называется дефолтным именем, а не «услуга abc-123». */
export type ServiceNameLookup = (
  serviceId: string,
) => { name: string; description?: string | null; unit?: string | null } | undefined;

/**
 * Собрать черновик счёта по записи.
 *
 * ГЛАВНОЕ ПРАВИЛО: сумма строк обязана сойтись с итогом записи ДО ЦЕНТА. Иначе
 * бригадир закрыл визит на €250, а клиент получил счёт на €248 — и спор о двух
 * евро стоит дороже любого счёта.
 */
export function generateInvoiceFromAppointment(
  appointment: Appointment,
  settings: InvoiceGeneratorSettings,
  serviceName: ServiceNameLookup,
): GeneratedInvoiceDraft {
  const issuedOn = appointment.date;
  return {
    lines: buildLines(appointment, settings, serviceName),
    issuedOn,
    dueOn: addDaysYmd(issuedOn, Math.max(0, settings.dueDays)),
    notes: settings.footerNote?.trim() || null,
    clientId: appointment.client_id ?? null,
    teamId: appointment.team_id ?? null,
  };
}

function buildLines(
  appointment: Appointment,
  settings: InvoiceGeneratorSettings,
  serviceName: ServiceNameLookup,
): GeneratedInvoiceLine[] {
  const total = round2(appointment.total_amount);
  const services = appointment.services ?? [];

  // Одной строкой — либо по настройке, либо когда расписывать нечего.
  if (settings.lineSource === "total" || services.length === 0) {
    return [
      {
        title: lineTitle(appointment, settings),
        qty: 1,
        unitPrice: total,
      },
    ];
  }

  const gross = subtotal(services);
  // Визит без денег (гарантия, переделка) — одна строка на ноль: расписывать
  // прайс на бесплатной работе значит обещать клиенту счёт, которого не будет.
  if (gross <= 0) {
    return [
      { title: lineTitle(appointment, settings), qty: 1, unitPrice: total },
    ];
  }

  // МАСШТАБ ПО ИТОГУ ЗАПИСИ, А НЕ ПО ПРАЙСУ. `total_amount` — то число, на
  // котором визит закрыли: в нём уже сидит скидка на весь визит, а у записи с
  // ручным итогом оно из услуг вообще не выводится. Считать строки по прайсу
  // значило бы выставить счёт на сумму, отличную от денег и долгов.
  const factor = total / gross;
  const lines: GeneratedInvoiceLine[] = [];
  let printed = 0;

  services.forEach((service, i) => {
    const last = i === services.length - 1;
    const qty = service.quantity > 0 ? service.quantity : 1;
    // ИМЯ БЕРЁТСЯ ИЗ СНИМКА ЗАПИСИ, И ТОЛЬКО ПОТОМ ИЗ КАТАЛОГА.
    //
    // `serviceName` в строке записи — это имя НА ДЕНЬ ВИЗИТА: его кладут при
    // сохранении именно затем, чтобы документ пережил и переименование, и
    // удаление услуги. Спрашивать каталог первым значит спрашивать «как эта
    // работа называется СЕЙЧАС», хотя счёт выставляется за то, что сделали
    // тогда. А если услугу стёрли насовсем, каталог не ответит вовсе, и счёт
    // печатал бы дефолтную строку вместо настоящего названия работы.
    //
    // Каталог остаётся вторым источником: у записей, сделанных до 25 августа
    // 2026, снимка ещё нет.
    const title =
      service.serviceName?.trim() ||
      serviceName(service.serviceId)?.name?.trim() ||
      settings.defaultLineTitle;
    // ОПИСАНИЕ ЕДЕТ И В ВЕТКУ СХЛОПЫВАНИЯ. Иначе оно исчезает молча ровно там,
    // где строка и так выглядит странно («Чистка × 3»).
    const description =
      serviceName(service.serviceId)?.description?.trim() || null;
    // Единица — тем же порядком: снимок, затем каталог.
    const unit =
      service.unit?.trim() || serviceName(service.serviceId)?.unit?.trim() || null;
    // Последняя строка добирает ВЕСЬ остаток, а не свою долю: центы от деления
    // и от скидки копятся именно в ней, и документ обязан сойтись с записью.
    const want = last ? round2(total - printed) : round2(lineTotal(service) * factor);
    const unitPrice = round2(want / qty);
    // Тем же правилом, что запишет сервер, а не своим умножением в double:
    // именно по сравнению actual с want решается, выразима ли позиция как
    // «количество × цена». Разойдись эти два правила — генератор молча решил
    // бы «выразима», сервер записал бы другой цент, и главный закон
    // (сумма строк сходится с итогом записи) перестал бы выполняться.
    const actual = invoiceLineTotal(qty, unitPrice);
    // Цент бывает невыразим в `количество × цена` (100 ÷ 3 = 33,33 даёт 99,99).
    // Тогда позиция сворачивается в одну штуку, а количество уходит в
    // название: сумма остаётся точной, и клиент по-прежнему видит, сколько
    // единиц ему сделали. Отрицательных цен здесь нет намеренно — сервер их
    // не принимает, и «скидка минусом» упала бы уже при выставлении.
    //
    // СХЛОПЫВАЕТСЯ ЛЮБАЯ СТРОКА, А НЕ ТОЛЬКО ПОСЛЕДНЯЯ (2026-08-21). С тех пор
    // как прайс спрашивает цену ЗА ВСЮ СТРОКУ («три комнаты — €100»), деление
    // на количество перестало быть редкостью: неделимый цент теперь обычное
    // дело. Раньше остаток от НЕпоследней строки молча утекал в последнюю —
    // документ сходился с записью, но позиция печаталась как «3 × €33,33 =
    // €99,99», то есть не той суммой, которую человек назначил. Теперь каждая
    // строка либо выражается точно, либо честно превращается в «× 3» с
    // назначенной суммой. Сумма строк по-прежнему сходится с итогом записи до
    // цента — это главный закон генератора, и он не тронут.
    if (actual !== want) {
      lines.push({
        // ЕДИНИЦА ЕДЕТ ВМЕСТЕ С КОЛИЧЕСТВОМ В НАЗВАНИЕ: «Трасса × 4 м». Здесь
        // колонка «Кол-во» печатает «1» — количество ушло в заголовок, и без
        // единицы рядом с ним число снова становится безымянным.
        title: qty > 1 ? `${title} × ${qty}${unit ? ` ${unit}` : ""}` : title,
        qty: 1,
        unitPrice: want,
        description,
        // У свёрнутой строки количество равно единице — подписывать «1 м»
        // нечего, слово уже стоит в названии.
        unit: null,
      });
      printed = round2(printed + want);
      return;
    }
    lines.push({ title, qty, unitPrice, description, unit });
    printed = round2(printed + actual);
  });

  return lines;
}

/** Название строки для «одной строкой»: сначала то, что написал диспетчер в
 *  записи, потом дефолт компании. Пустая строка недопустима — документ без
 *  предмета не читается. */
function lineTitle(
  appointment: Appointment,
  settings: InvoiceGeneratorSettings,
): string {
  return (
    appointment.comment?.trim() ||
    settings.defaultLineTitle.trim() ||
    INVOICE_GENERATOR_DEFAULTS.defaultLineTitle
  );
}

/** YYYY-MM-DD + N дней. Считается в UTC намеренно: дата документа — календарный
 *  день без времени, и местная полночь не должна сдвигать срок оплаты. */
export function addDaysYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
