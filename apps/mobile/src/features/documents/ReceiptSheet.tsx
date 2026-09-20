import { Share, View } from "react-native";
import type { Receipt } from "@babun/shared/local/finance/receipt";
import type { Appointment } from "@babun/shared/local/appointments";
import { BottomSheet, SHEET_EXIT_MS } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { GradientButton } from "@/components/ui/GradientButton";
import { NavRow, RowGroupBody } from "@/components/ui/card-rows";
import { useThemeColors } from "@/theme/colors";
import { humanDay } from "@/features/appointments/helpers";
import { useInvoice } from "@/features/invoices/queries";
import {
  buildReceiptDocument,
  receiptCoversFullAmount,
  receiptLinesFromAppointment,
  receiptLinesFromInvoice,
  type ReceiptLineItemsInput,
} from "./receipt-document";
import { buildReceiptPdfHtml } from "./receipt-pdf";
import { ReceiptPaper } from "./ReceiptPaper";
import { useReceiptAppointment } from "./receipts-queries";
import { buildReceiptShareText } from "./receipt-text";
import { shareHtmlAsPdf } from "./share-pdf";
import { notify } from "@/lib/notify";

// ЧЕК ОТКРЫВАЕТСЯ ЛИСТОМ, А НЕ ЭКРАНОМ (владелец 2026-08-12: «если я нажимаю
// на чек — там полностью вся информация, запись, клиент… напрямую на клиента
// можно выйти»; и там же: «не надо делать лишние страницы»).
//
// Лист — потому что чек ПОКАЗЫВАЮТ, а не правят: документ неизменяем, править
// в нём нечего, и уходить с ленты чеков ради двух строк незачем.
//
// Строки внутри — двери: запись, инвойс, счёт. Это и есть «вся информация»:
// не пересказ чека, а дорога к тому, за что он выдан. Двери «Клиент» и
// «Оплата» здесь были до 2026-09-20 — владелец после показа чека со строками
// попросил убрать обе из самого чека: «клиент убираем», «оплата давай не
// писать» (тот же разговор снял их и с бумаги — `receipt-document.ts`).
// Карточку клиента, если нужна, открывают из записи или из ленты клиентов —
// не отсюда.
export function ReceiptSheet({
  receipt,
  appointment,
  accountName,
  onClose,
  onOpen,
}: {
  /** null — листа нет вовсе (он не «пустой», а не открыт). */
  receipt: Receipt | null;
  /** Запись, за которую выдан чек, если она в загруженном срезе. Не нашли —
   *  строка молчит: соврать «записи нет» хуже, чем не сказать ничего. */
  appointment: Appointment | null;
  /** Имя счёта, на который легли деньги. */
  accountName: string | null;
  onClose: () => void;
  /** Уводит с экрана. Лист сначала уезжает — иначе новый экран откроется
   *  ПОД модалом и человек увидит тот же чек. */
  onOpen: (href: string) => void;
}) {
  const t = useThemeColors();

  // ИНВОЙС — ТЕМ ЖЕ ХУКОМ, ЧТО СТРАНИЦА СЧЁТА (`useInvoice`): единственный
  // способ получить одним запросом и итог, и строки.
  const invoiceId = receipt?.invoice_id ?? undefined;
  const invoiceQuery = useInvoice(invoiceId);

  // ЗАПИСЬ БЕЗ СВОЕГО ИНВОЙСА: приоритет у уже загруженного ПРОПА — его
  // считают рядом с листом чека `receipts.tsx` и `DocumentsPanel`, и тогда
  // повторный запрос не заводится вовсе. Репозиторий записей читается ТОЛЬКО
  // когда пропа нет (лист чека прямо со страницы записи, `AppointmentFilesBlock`
  // намеренно не передаёт её — «мы и так на ней»), а строки взять больше
  // неоткуда.
  const appointmentId =
    receipt && receipt.appointment_id && !invoiceId
      ? receipt.appointment_id
      : undefined;
  const appointmentFromProp =
    appointment && appointment.id === appointmentId ? appointment : null;
  const appointmentQuery = useReceiptAppointment(
    appointmentFromProp ? undefined : appointmentId,
  );

  if (!receipt) return null;

  const r = receipt;
  const dead = r.status === "void";
  const linkedAppointment = appointmentFromProp ?? appointmentQuery.data ?? null;

  // КНОПКА PDF ЖДЁТ ИСТОЧНИК СТРОК, А НЕ ПЕЧАТАЕТ ДОКУМЕНТ НАПОЛОВИНУ: пока
  // инвойс или запись ещё грузятся, «Поделиться PDF» показывает спиннер и не
  // нажимается (решение разработчика 2026-09-20) — секунду спустя чек уходит
  // с уже полным перечнем, а не с версией «как получилось».
  const linesLoading =
    !r.lines &&
    ((!!invoiceId && invoiceQuery.isLoading) ||
      (!!appointmentId && !appointmentFromProp && appointmentQuery.isLoading));

  // ПЕРЕЧЕНЬ ПЕЧАТАЕТСЯ ТОЛЬКО КОГДА ЧЕК ЗАКРЫВАЕТ ИСТОЧНИК ЦЕЛИКОМ
  // (`receiptCoversFullAmount`) — у оплаты частями каждая проводка выдаёт свой
  // чек, и печатать на чеке частичного платежа ПОЛНЫЙ перечень работ значило
  // бы соврать суммой.
  let lineItems: ReceiptLineItemsInput | undefined;
  // СВОЙ СНИМОК СИЛЬНЕЕ ЛЮБОГО ИСТОЧНИКА. Чеки, выписанные с 20.09.2026,
  // несут перечень внутри себя (`receipts.lines`) — он заморожен в момент
  // выдачи и не меняется, даже если запись потом поправят. Ходить за живой
  // записью, имея его на руках, значило бы печатать НЕ ТОТ документ, что у
  // клиента в руках. Проверка «покрывает ли чек источник целиком» здесь тоже
  // не нужна: снимок сделан ровно по этому чеку, а не по чужой работе.
  if (r.lines && r.lines.length > 0) {
    lineItems = { lines: r.lines };
  } else if (invoiceId && invoiceQuery.data) {
    if (receiptCoversFullAmount(r.amount, invoiceQuery.data.total)) {
      lineItems = receiptLinesFromInvoice(invoiceQuery.data.lines);
    }
  } else if (appointmentId && linkedAppointment) {
    if (receiptCoversFullAmount(r.amount, linkedAppointment.total_amount)) {
      lineItems = receiptLinesFromAppointment(linkedAppointment);
    }
  }
  // ЭКРАН И PDF — ОДНА МОДЕЛЬ: обе печатают РОВНО этот объект, а не считают
  // похожий рядом (та же причина, что у `InvoiceDocument`).
  const doc = buildReceiptDocument(r, lineItems);

  const leave = (href: string) => {
    onClose();
    setTimeout(() => onOpen(href), SHEET_EXIT_MS);
  };

  // ОБА СПОСОБА ПОДЕЛИТЬСЯ ЗАКРЫВАЮТ ЛИСТ ПЕРВЫМ ДЕЙСТВИЕМ. Системное меню
  // «Поделиться» — тоже модал: пока наш лист уезжает, оно не появится вовсе
  // (та же причина, что у двери `leave`).
  const sharePdf = () => {
    onClose();
    setTimeout(() => {
      void shareHtmlAsPdf({
        html: buildReceiptPdfHtml(r, lineItems),
        fileName: `Чек ${r.number}`,
        dialogTitle: `Чек ${r.number}`,
      }).catch((error: unknown) =>
        notify("Не удалось поделиться PDF", (error as Error).message),
      );
    }, SHEET_EXIT_MS);
  };

  const shareText = () => {
    onClose();
    setTimeout(() => {
      void Share.share({
        message: buildReceiptShareText(doc),
      }).catch((error: unknown) =>
        notify("Не удалось выслать чек", (error as Error).message),
      );
    }, SHEET_EXIT_MS);
  };

  return (
    <BottomSheet
      padded={false}
      visible
      onClose={onClose}
      title={`Чек ${r.number}`}
      scroll
      footer={
        // «ПОДЕЛИТЬСЯ» ЖИВЁТ ЗДЕСЬ, А НЕ НА ЭКРАНЕ: выслать можно только
        // конкретный чек, кнопка внизу списка не знала бы, какой именно. Тот
        // же дуэт и те же слова, что на экране инвойса (`app/invoices/[id].tsx`):
        // PDF — основное действие, текст — второе.
        dead ? null : (
          <View style={{ gap: 8 }}>
            <GradientButton
              label="Поделиться PDF"
              loading={linesLoading}
              onPress={sharePdf}
            />
            <Button label="Поделиться текстом" variant="secondary" onPress={shareText} />
          </View>
        )
      }
    >
      {/* БУМАГА ЧЕКА — ЗЕРКАЛО PDF, ОДИН В ОДИН ПО СОСТАВУ И ПОРЯДКУ (владелец
          2026-09-20). Белая карточка на серой подложке — та же геометрия, что
          у зеркала инвойса (`InvoicePaper`), собранная из ТОЙ ЖЕ модели
          (`doc`), которую печатает PDF. Служебные строки ниже (Выдан / Счёт /
          Запись) — уже не документ, а дорога внутри приложения, поэтому они
          стоят ПОД бумагой, на своём белом фоне, а не внутри неё. */}
      <View className="px-4 pb-4 pt-1">
        <View
          style={{
            backgroundColor: t.canvas,
            borderRadius: t.radius.card,
            borderCurve: "continuous",
            padding: 12,
          }}
        >
          <ReceiptPaper doc={doc} />
        </View>
      </View>

      <View className="px-4 pb-2">
        <RowGroupBody first last>
          <NavRow label="Выдан" value={humanDay(r.issued_on)} />
          {accountName ? (
            <NavRow label="Счёт" value={accountName} separated />
          ) : null}
          {appointment ? (
            <NavRow
              label="Запись"
              value={`${humanDay(appointment.date)}, ${appointment.time_start}`}
              separated
              // Тот же адрес, которым запись открывают из ленты денег:
              // календарь сам встаёт на её день и команду, а `from` — дорога
              // назад: лист живёт во вкладке «Финансы», и закрыв запись,
              // человек возвращается к документам, а не остаётся в календаре
              // (вкладки НЕ стек, владелец 2026-08-15).
              onPress={() =>
                leave(
                  `/(dashboard)?appointmentId=${appointment.id}&date=${appointment.date}` +
                    (appointment.team_id ? `&teamId=${appointment.team_id}` : "") +
                    "&from=finances",
                )
              }
            />
          ) : null}
          {r.invoice_id ? (
            <NavRow
              label="Инвойс"
              value="Открыть"
              separated
              onPress={() => leave(`/invoices/${r.invoice_id}`)}
            />
          ) : null}
        </RowGroupBody>
      </View>
    </BottomSheet>
  );
}
