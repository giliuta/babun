import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { Platform } from "react-native";
import type { Appointment } from "@babun/shared/local/appointments";
import type { Client } from "@babun/shared/local/clients";
import type { CalendarSettings } from "@babun/shared/local/calendar-settings";
import { isOnline } from "@babun/shared/sync";
import { randomUuid } from "@babun/shared/sync/uuid";
import { formatEURExact } from "@babun/shared/common/utils/money";
import { setSelfReminder } from "@/features/calendar/reminders";
import type { SelfReminder } from "@/lib/reminder-time";
import { serverReason } from "@/features/calendar/server-reason";
import type { Team } from "@/features/reference/queries";
import type { useToast } from "@/components/ui/Toast";
import { changedFields } from "@/features/appointments/member-writes";
import { overpaymentToRefund, pendingPaymentToSend } from "@/features/appointments/payment-draft";
import { uploadPendingFiles } from "@/features/appointments/pending-files";
import { confirmAction } from "@/lib/confirm";
import { haptics } from "@/lib/haptics";
import { notify } from "@/lib/notify";
import { reminderToast as reminderToastWith } from "./reminder-toast";
import type { BookDraft } from "./use-book-draft";
import type { BookReferences } from "./use-book-references";

export interface BookSaveInput {
  canSave: boolean;
  bookingBusy: boolean;
  missingHint: string;
  toast: ReturnType<typeof useToast>;
  clientNote: { commit: () => void };
  objectNote: { commit: () => void };
  isEdit: boolean;
  editId: string | null;
  editing: Appointment | null;
  editBaselineRef: MutableRefObject<string | null>;
  buildPatch: () => Partial<Appointment>;
  effectiveTotal: number;
  overpayRequestRef: MutableRefObject<string | null>;
  paymentRequestIdRef: MutableRefObject<string>;
  savingRef: MutableRefObject<boolean>;
  refundOverpayment: BookDraft["refundOverpayment"];
  updateMut: BookDraft["updateMut"];
  booking: BookReferences["booking"];
  newRecordIdRef: MutableRefObject<string>;
  kind: "work" | "event";
  eventReminderOffset: number | null;
  team: Team | null | undefined;
  calendarSettings: CalendarSettings | undefined;
  client: Client | null;
  selfReminder: SelfReminder | null;
  setSelfReminderRule: Dispatch<SetStateAction<SelfReminder | null>>;
  setReminderSheetOpen: Dispatch<SetStateAction<boolean>>;
  pendingPayment: BookDraft["pendingPayment"];
  date: string;
  timeStart: string;
  status: BookDraft["status"];
  businessNow: BookDraft["businessNow"];
  recordPayment: BookDraft["recordPayment"];
  pendingFiles: BookDraft["pendingFiles"];
  tenantIdForFiles: BookDraft["tenantIdForFiles"];
  queryClientForFiles: BookDraft["queryClientForFiles"];
  leaveBook: () => void;
  /** Новая запись создана — черновик на телефоне больше не нужен. */
  onCreated?: () => void;
}

/** «Сохранить» / «Создать» and the self-reminder bell (no hooks inside). */
export function bookSaveActions({
  canSave,
  bookingBusy,
  missingHint,
  toast,
  clientNote,
  objectNote,
  isEdit,
  editId,
  editing,
  editBaselineRef,
  buildPatch,
  effectiveTotal,
  overpayRequestRef,
  paymentRequestIdRef,
  savingRef,
  refundOverpayment,
  updateMut,
  booking,
  newRecordIdRef,
  kind,
  eventReminderOffset,
  team,
  calendarSettings,
  client,
  selfReminder,
  setSelfReminderRule,
  setReminderSheetOpen,
  pendingPayment,
  date,
  timeStart,
  status,
  businessNow,
  recordPayment,
  pendingFiles,
  tenantIdForFiles,
  queryClientForFiles,
  leaveBook,
  onCreated,
}: BookSaveInput) {
  const reminderToast = (
    res: Awaited<ReturnType<typeof setSelfReminder>>,
    rule: SelfReminder | null,
  ) => reminderToastWith(toast, res, rule, Platform.OS === "android");

  const pickSelfReminder = (rule: SelfReminder | null) => {
    setSelfReminderRule(rule);
    setReminderSheetOpen(false);
    // У сохранённой записи пуш ставится сразу — это не поле записи, его не
    // надо «сохранять»; у новой — после создания, когда появится id.
    if (isEdit && editing && tenantIdForFiles) {
      void setSelfReminder(
        { ...editing, date, time_start: timeStart },
        rule,
        team?.timezone ?? calendarSettings?.timezone ?? "Europe/Nicosia",
        tenantIdForFiles,
        client?.full_name,
      ).then((res) => reminderToast(res, rule));
    }
  };

  const save = async () => {
    if (savingRef.current) return;
    if (!canSave || bookingBusy) {
      toast(missingHint, "info");
      return;
    }
    // ОПЛАТА НОВОЙ ЗАПИСИ — ТОЛЬКО ПРИ СВЯЗИ. Без сети запись уходит в очередь,
    // а оплата следом падала: записи на сервере ещё нет, и набранные деньги
    // пропадали с уведомлением «оплата не записана».
    if (!isEdit && pendingPayment && kind === "work" && !isOnline()) {
      haptics.warning();
      toast("Оплата записывается только при связи — создайте запись без оплаты или дождитесь сети", "info");
      return;
    }
    savingRef.current = true;
    // Тап по кнопке фокус у поля не отбирает — заметки клиента и объекта
    // дописываем сами, иначе набранное осталось бы в черновике поля.
    clientNote.commit();
    objectNote.commit();
    try {
      if (isEdit && editId) {
        // Правка идёт мимо useBookingSave: тот хук — про РОЖДЕНИЕ заявки и
        // её хвост (гашение напоминания ТО, постановка push события). У
        // существующей записи этот хвост уже отработал в день создания.
        // Сотрудник шлёт только изменённое: каждое поле в двери сервера
        // требует своего права, и нетронутый клиент в патче стоил бы отказа
        // тому, у кого нет «Клиент: Меняет». Снимок — та же подпись, что
        // считает «есть несохранённое».
        //
        // ТОЛЬКО ИЗМЕНЁННОЕ — У ВСЕХ, НЕ ТОЛЬКО У СОТРУДНИКА. Владелец слал патч целиком: форма гидрируется один
        // раз, и всё, что за это время поменяли с другого телефона (мастер
        // принял оплату и закрыл визит, диспетчер сдвинул время), «Сохранить»
        // молча возвращало назад — статус «запланирована» поверх оплаченной.
        // Снимок знает, какой форма была при открытии, поэтому уходит ровно
        // то, что тронули на этом экране.
        const patch = changedFields(
          editBaselineRef.current
            ? (JSON.parse(editBaselineRef.current) as Partial<Appointment>)
            : (editing ?? {}),
          buildPatch(),
        );
        // ИТОГ НИЖЕ ПОЛУЧЕННОГО — СНАЧАЛА ВЕРНУТЬ КЛИЕНТУ РАЗНИЦУ (платежи 20 + 10 + 20, потом итог
        // изменили на 30). Сервер такой итог не сохранит («Полученная
        // сумма больше итога заявки»), и форма упиралась в отказ без выхода:
        // «Снять» — это «деньги не поступили», а вернуть часть было нечем.
        // Поэтому «Сохранить» спрашивает и возвращает разницу возвратом
        // клиенту (`refund_appointment_overpayment`), а потом сохраняет итог.
        const refund = overpaymentToRefund(editing ?? null, effectiveTotal);
        if (refund && "total_amount" in patch) {
          const ok = await confirmAction(`Вернуть клиенту ${formatEURExact(refund.amountCents / 100)}?`, {
            message: `Итог ${formatEURExact(effectiveTotal)}, а получено ${formatEURExact(refund.receivedCents / 100)}. Разница вернётся клиенту с последних платежей — в финансах будет возврат.`,
            confirmLabel: `Вернуть ${formatEURExact(refund.amountCents / 100)}`,
          });
          if (!ok) return;
          overpayRequestRef.current ??= randomUuid();
          await refundOverpayment.mutateAsync({
            appointmentId: editId,
            amount: refund.amountCents / 100,
            requestId: overpayRequestRef.current,
          });
        }
        if (Object.keys(patch).length > 0) {
          await updateMut.mutateAsync({ id: editId, patch });
        }
        overpayRequestRef.current = null;
        toast("Изменения сохранены", "success");
        haptics.success();
      } else {
        const created = await booking.save({
          // ОДИН НОМЕР НА ЖИЗНЬ ФОРМЫ Новый
          // номер на каждое «Создать» давал партнёру вторую запись (и второе
          // SMS), когда сервер её уже вставил, а ответ оборвался: «Не удалось
          // сохранить» — и второй тап. С тем же номером повтор упирается в
          // уже вставшую запись, а её дверь отвечает успехом (мутация
          // создания в `calendar/mutations.ts`).
          patch: { ...buildPatch(), id: newRecordIdRef.current },
          kind,
          eventReminderOffset,
          timezone:
            team?.timezone ?? calendarSettings?.timezone ?? "Europe/Nicosia",
        });
        onCreated?.();
        if (selfReminder && tenantIdForFiles) {
          void setSelfReminder(
            created,
            selfReminder,
            team?.timezone ?? calendarSettings?.timezone ?? "Europe/Nicosia",
            tenantIdForFiles,
            client?.full_name,
          ).then((res) => reminderToast(res, selfReminder));
        }
        // ОПЛАТА И ФАЙЛЫ НОВОЙ ЗАПИСИ — ПОСЛЕ ЗАКРЫТИЯ ФОРМЫ (всё мгновенно). Запись уже есть; ждать
        // проводку денег (~1,5 с на сервере) и загрузку каждого файла форма не
        // должна. Они уходят вслед, а если сорвутся — скажут словами, как и
        // раньше: вводить заново нечего, запись сохранена.
        if (pendingPayment && created.kind === "work") {
          // Деньги новой записи ждали её id — уходят тем же событием, что
          // тап по счёту у существующей записи (STORY-065).
          // `mutateAsync`, а не `mutate` с onError: форма к ответу уже
          // закрыта, и отклики вызова у снятого наблюдателя не звучат —
          // обещание же отвечает всегда.
          // Сумма, вид и закрытие визита — по форме СЕЙЧАС, а не по тапу
          // (`pendingPaymentToSend`): итог и время могли поменяться после.
          const send = pendingPaymentToSend(
            pendingPayment,
            { total: effectiveTotal, date, time_start: timeStart, status },
            businessNow(),
          );
          if (send) {
            void recordPayment
              .mutateAsync({
                appointmentId: created.id,
                accountId: pendingPayment.accountId,
                amount: send.amount,
                requestId: paymentRequestIdRef.current,
                kind: send.kind,
                closeVisit: send.closeVisit,
              })
              .catch((e) =>
                notify("Запись создана, оплата не записана", (e as Error).message),
              );
          }
        }
        if (pendingFiles.length > 0 && tenantIdForFiles) {
          // Файлы новой записи — тем же путём, что «Добавить» у сохранённой.
          void uploadPendingFiles({
            tenantId: tenantIdForFiles,
            appointmentId: created.id,
            clientId: created.client_id ?? null,
            locationId: created.location_id ?? null,
            files: pendingFiles,
            queryClient: queryClientForFiles,
          })
            .then((failed) => {
              if (failed.length > 0) {
                notify("Запись создана, файлы не загружены", failed.join(", "));
              }
            })
            .catch((e) => notify("Запись создана, файлы не загружены", (e as Error).message));
        }
      }
      leaveBook();
    } catch (e) {
      haptics.error();
      // Причина сервера словами, без «updateAppointment:».
      notify("Не удалось сохранить", serverReason(e) ?? (e as Error).message);
    } finally {
      savingRef.current = false;
    }
  };

  return { pickSelfReminder, save };
}
